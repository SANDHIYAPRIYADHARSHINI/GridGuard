"""
GridGuard core engine (Review 2)
================================

One place that owns the security logic, so the CLI gateway, the MQTT listener
and the Streamlit dashboard all behave identically.

Pipeline for every incoming telemetry packet
--------------------------------------------
1. Parse JSON                      -> malformed_json
2. Device allow-list               -> unauthorized_device
3. Isolation check                 -> packet silently blocked (counted)
4. Rate limit                      -> message_flood
5. HMAC-SHA256 signature           -> invalid_hmac / hmac_missing (strict mode)
6. Replay protection (seq + ts)    -> replay_detected / stale_timestamp
7. Plausibility + threshold rules  -> impossible_reading, *_critical, *_warning,
                                      power_mismatch, energy_rollback, sudden_spike, meter_reported_alert
8. Auto-isolation                  -> meter_isolated (N high/critical strikes in a window)

HMAC message format
-------------------
The signature is HMAC-SHA256 over the *text tokens exactly as they appear in the
JSON*, joined with "|":

    meter_id|seq|ts|temp_c|voltage_v|current_a|power_kw|alert|energy_wh

For example the ESP32 prints  "temp_c":28.0  so it must sign the text "28.0"
(not 28). Signing printed text avoids float-formatting mismatches between C++
and Python. Fields that are absent are signed as an empty string, which keeps the
Review-1 firmware (no seq / ts / hmac) working when strict mode is off.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
LOGS_DIR = ROOT / "logs"
DB_PATH = LOGS_DIR / "gridguard.db"

# --------------------------------------------------------------------------- #
# Asset registry (device allow-list)
# --------------------------------------------------------------------------- #
# NOTE: demo keys only. In the real build, provision a unique random key per
# meter (flash it to the ESP32, keep it out of git) and load these from env/secret store.
METERS: dict[str, dict] = {
    "MTR-001": {
        "name": "Meter A",
        "site": "Feeder 1 · Transformer T1",
        "firmware": "r1.0",
        "key": os.getenv("GG_KEY_MTR001", "gridguard-demo-key-A"),
    },
    "MTR-002": {
        "name": "Meter B",
        "site": "Feeder 2 · Transformer T2",
        "firmware": "r1.0",
        "key": os.getenv("GG_KEY_MTR002", "gridguard-demo-key-B"),
    },
}

LIMITS = dict(
    volt_warn=(216.0, 244.0),
    volt_crit=(200.0, 255.0),
    cur_warn=3.5,
    cur_crit=8.0,
    temp_warn=33.0,
    temp_crit=42.0,
    pow_warn=0.8,
    pow_crit=1.8,
    # physically plausible sensor range - outside means tampering / broken sensor
    volt_abs=(0.0, 1000.0),
    cur_abs=(0.0, 100.0),
    temp_abs=(-40.0, 150.0),
    rate_window=5.0,       # seconds
    rate_max=8,            # packets per window (a healthy meter sends 1 per 2 s)
    max_skew=30.0,         # seconds of allowed clock difference
    spike_factor=2.5,      # new power > factor * recent mean ...
    spike_min_delta=0.3,   # ... and at least this many kW above it
    energy_tolerance=0.005,  # Wh; cumulative energy may not go down by more than this
    strike_window=60.0,    # auto-isolation: N strikes inside this window
)

SEV_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

SIGNED_FIELDS = ("meter_id", "seq", "ts", "temp_c", "voltage_v", "current_a", "power_kw", "alert", "energy_wh")


def _tok(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return "" if v is None else str(v)


def canonical(data: dict) -> str:
    return "|".join(_tok(data.get(k)) for k in SIGNED_FIELDS)


def sign(data: dict, key: str) -> str:
    return hmac.new(key.encode(), canonical(data).encode(), hashlib.sha256).hexdigest()


# --------------------------------------------------------------------------- #
# Result objects
# --------------------------------------------------------------------------- #
@dataclass
class Finding:
    severity: str
    type: str
    reason: str


@dataclass
class Verdict:
    raw: str = ""
    meter_id: str | None = None
    accepted: bool = False
    blocked: bool = False          # dropped because the meter is isolated
    authenticated: bool | None = None  # True = HMAC verified, False = unsigned (legacy), None = n/a
    isolated_now: bool = False
    findings: list[Finding] = field(default_factory=list)

    @property
    def severity(self) -> str:
        if not self.findings:
            return "info"
        return max((f.severity for f in self.findings), key=lambda s: SEV_RANK[s])

    @property
    def label(self) -> str:
        if self.blocked:
            return "BLOCKED"
        if not self.accepted:
            return "REJECTED"
        return "FLAGGED" if self.findings else "ACCEPTED"


SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry(
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, meter_id TEXT,
    temp_c REAL, voltage_v REAL, current_a REAL, power_kw REAL, energy_wh REAL,
    seq INTEGER, flagged INTEGER, raw TEXT, reported_wh REAL);
CREATE INDEX IF NOT EXISTS ix_tel_meter ON telemetry(meter_id, id);
CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, meter_id TEXT, severity TEXT,
    type TEXT, reason TEXT, source TEXT, action TEXT, raw TEXT, addr TEXT, meter_state TEXT);
CREATE INDEX IF NOT EXISTS ix_evt_ts ON events(ts);
CREATE TABLE IF NOT EXISTS meters(
    meter_id TEXT PRIMARY KEY, status TEXT, last_seen REAL, last_seq INTEGER,
    energy_wh REAL, accepted INTEGER, rejected INTEGER, blocked INTEGER, isolated_reason TEXT, reported_wh REAL);
CREATE TABLE IF NOT EXISTS counters(key TEXT PRIMARY KEY, value INTEGER);
"""


class GridGuardEngine:
    def __init__(self, db_path: Path | str = DB_PATH, strict_hmac: bool = False,
                 auto_isolate: bool = True, auto_isolate_strikes: int = 3):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.strict_hmac = strict_hmac
        self.auto_isolate = auto_isolate
        self.auto_isolate_strikes = auto_isolate_strikes
        self.check_timestamp = True
        self._addr = "local"          # where the packet being processed came from (serial port, MQTT topic, IP, ...)
        self._lock = threading.RLock()
        self._rate: dict[str, deque] = defaultdict(deque)
        self._strikes: dict[str, deque] = defaultdict(deque)
        self._last_rate_event: dict[str, float] = {}
        self.sim_last: dict[str, float] = {}
        self._init_db()

    # ------------------------------------------------------------------ db --
    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.db_path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def _init_db(self) -> None:
        with self._lock, self._conn() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(SCHEMA)
            # databases created by the first Review-2 build lack these columns
            for table, col, decl in (("events", "addr", "TEXT"), ("events", "meter_state", "TEXT"),
                                     ("telemetry", "reported_wh", "REAL"), ("meters", "reported_wh", "REAL")):
                if col not in [r[1] for r in c.execute(f"PRAGMA table_info({table})")]:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
            for mid in METERS:
                c.execute(
                    "INSERT OR IGNORE INTO meters(meter_id,status,last_seen,last_seq,energy_wh,accepted,rejected,blocked,isolated_reason) "
                    "VALUES(?,?,?,?,?,?,?,?,?)",
                    (mid, "online", None, 0, 0.0, 0, 0, 0, None),
                )

    def reset(self) -> None:
        with self._lock, self._conn() as c:
            for t in ("telemetry", "events", "meters", "counters"):
                c.execute(f"DELETE FROM {t}")
        self._rate.clear()
        self._strikes.clear()
        self._last_rate_event.clear()
        self.sim_last.clear()
        self._init_db()

    def _bump(self, c: sqlite3.Connection, key: str, n: int = 1) -> None:
        c.execute(
            "INSERT INTO counters VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=value+?",
            (key, n, n),
        )

    def _log_event(self, c, ts, meter_id, sev, typ, reason, source, action, raw) -> None:
        r = c.execute("SELECT status FROM meters WHERE meter_id=?", (meter_id,)).fetchone()
        state = r["status"] if r else "unregistered"
        c.execute(
            "INSERT INTO events(ts,meter_id,severity,type,reason,source,action,raw,addr,meter_state) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (ts, meter_id, sev, typ, reason, source, action, (raw or "")[:2000], self._addr, state),
        )

    # -------------------------------------------------------------- ingest --
    def ingest(self, packet: str | dict, source: str = "serial", addr: str | None = None) -> Verdict:
        """addr = where the packet came from: serial port, MQTT topic, client IP ... (stored with every event)."""
        with self._lock:
            self._addr = addr or source
            return self._ingest(packet, source)

    def _reject(self, c, v: Verdict, sev: str, typ: str, reason: str, source: str, now: float) -> Verdict:
        v.accepted = False
        v.findings.append(Finding(sev, typ, reason))
        self._log_event(c, now, v.meter_id, sev, typ, reason, source, "rejected", v.raw)
        self._bump(c, "rejected")
        if v.meter_id in METERS:
            c.execute("UPDATE meters SET rejected=rejected+1 WHERE meter_id=?", (v.meter_id,))
        return v

    def _ingest(self, packet, source: str) -> Verdict:
        now = time.time()
        raw = (packet if isinstance(packet, str) else json.dumps(packet)).strip()
        v = Verdict(raw=raw)
        with self._conn() as c:
            # 1. parse ---------------------------------------------------------------
            try:
                data = json.loads(raw, parse_float=str, parse_int=str)
                if not isinstance(data, dict):
                    raise ValueError
            except Exception:
                return self._reject(c, v, "medium", "malformed_json", "Packet is not a valid JSON object", source, now)

            meter_id = str(data.get("meter_id", ""))[:40]
            v.meter_id = meter_id or None
            if not meter_id:
                return self._reject(c, v, "medium", "malformed_packet", "Packet has no meter_id", source, now)

            # 2. allow-list ---------------------------------------------------------
            if meter_id not in METERS:
                return self._reject(c, v, "critical", "unauthorized_device",
                                    f"Meter ID '{meter_id}' is not in the device allow-list", source, now)

            # 3. isolation ----------------------------------------------------------
            row = c.execute("SELECT * FROM meters WHERE meter_id=?", (meter_id,)).fetchone()
            if row["status"] == "isolated":
                c.execute("UPDATE meters SET blocked=blocked+1 WHERE meter_id=?", (meter_id,))
                self._bump(c, "blocked")
                v.blocked = True
                return v

            # 4. rate limit ---------------------------------------------------------
            dq = self._rate[meter_id]
            dq.append(now)
            while dq and now - dq[0] > LIMITS["rate_window"]:
                dq.popleft()
            if len(dq) > LIMITS["rate_max"]:
                if now - self._last_rate_event.get(meter_id, 0) > LIMITS["rate_window"]:
                    self._last_rate_event[meter_id] = now
                    return self._reject(c, v, "high", "message_flood",
                                        f"{len(dq)} packets in {LIMITS['rate_window']:.0f}s "
                                        f"(limit {LIMITS['rate_max']}) - possible flooding / DoS", source, now)
                self._bump(c, "rejected")
                c.execute("UPDATE meters SET rejected=rejected+1 WHERE meter_id=?", (meter_id,))
                v.accepted = False
                v.findings.append(Finding("high", "message_flood", "Dropped - rate limit still exceeded"))
                return v

            # 5. HMAC ---------------------------------------------------------------
            sig = data.get("hmac")
            if sig is None:
                if self.strict_hmac:
                    return self._reject(c, v, "high", "hmac_missing",
                                        "Unsigned packet rejected (strict HMAC mode)", source, now)
                v.authenticated = False
            else:
                expected = sign(data, METERS[meter_id]["key"])
                if not hmac.compare_digest(str(sig), expected):
                    return self._reject(c, v, "critical", "invalid_hmac",
                                        "HMAC signature mismatch - message altered or wrong key", source, now)
                v.authenticated = True

            # 6. replay -------------------------------------------------------------
            seq = None
            if data.get("seq") not in (None, ""):
                try:
                    seq = int(data["seq"])
                except (ValueError, TypeError):
                    return self._reject(c, v, "medium", "malformed_packet", "Invalid sequence number", source, now)
                if seq <= (row["last_seq"] or 0):
                    return self._reject(c, v, "high", "replay_detected",
                                        f"Sequence {seq} already used (last accepted {row['last_seq']})", source, now)
            if self.check_timestamp and data.get("ts") not in (None, ""):
                try:
                    skew = abs(now - float(data["ts"]))
                except (ValueError, TypeError):
                    return self._reject(c, v, "medium", "malformed_packet", "Invalid timestamp", source, now)
                if skew > LIMITS["max_skew"]:
                    return self._reject(c, v, "high", "stale_timestamp",
                                        f"Timestamp is {skew:.0f}s off (limit {LIMITS['max_skew']:.0f}s) - possible replay", source, now)

            # 7. values -------------------------------------------------------------
            try:
                temp = float(data["temp_c"])
                volt = float(data["voltage_v"])
                cur = float(data["current_a"])
                pw = data.get("power_kw")
                power = float(pw) if pw not in (None, "") else volt * cur / 1000.0
            except (KeyError, ValueError, TypeError):
                return self._reject(c, v, "medium", "malformed_packet",
                                    "Missing or non-numeric temp_c / voltage_v / current_a", source, now)
            if not all(math.isfinite(x) for x in (temp, volt, cur, power)):
                return self._reject(c, v, "medium", "malformed_packet", "NaN / infinite reading", source, now)
            reported = None                      # optional cumulative meter reading (Wh)
            if data.get("energy_wh") not in (None, ""):
                try:
                    reported = float(data["energy_wh"])
                except (ValueError, TypeError):
                    reported = float("nan")
                if not math.isfinite(reported) or reported < 0:
                    return self._reject(c, v, "medium", "malformed_packet", "Invalid energy_wh value", source, now)

            lo, hi = LIMITS["volt_abs"]
            bad = []
            if not lo <= volt <= hi:
                bad.append(f"voltage {volt:g} V")
            lo, hi = LIMITS["cur_abs"]
            if not lo <= cur <= hi:
                bad.append(f"current {cur:g} A")
            lo, hi = LIMITS["temp_abs"]
            if not lo <= temp <= hi:
                bad.append(f"temperature {temp:g} °C")
            if power < 0:
                bad.append(f"power {power:g} kW")
            if bad:
                return self._reject(c, v, "critical", "impossible_reading",
                                    "Physically impossible value(s): " + ", ".join(bad) + " - sensor tampering?", source, now)

            f = v.findings
            L = LIMITS
            if volt < L["volt_crit"][0] or volt > L["volt_crit"][1]:
                f.append(Finding("critical", "voltage_critical", f"Voltage {volt:.1f} V outside {L['volt_crit'][0]:.0f}-{L['volt_crit'][1]:.0f} V"))
            elif volt < L["volt_warn"][0] or volt > L["volt_warn"][1]:
                f.append(Finding("medium", "voltage_warning", f"Voltage {volt:.1f} V outside normal band {L['volt_warn'][0]:.0f}-{L['volt_warn'][1]:.0f} V"))
            if cur > L["cur_crit"]:
                f.append(Finding("critical", "current_critical", f"Current spike {cur:.2f} A (limit {L['cur_crit']:.0f} A)"))
            elif cur > L["cur_warn"]:
                f.append(Finding("medium", "current_warning", f"Elevated current {cur:.2f} A (warn {L['cur_warn']:.1f} A)"))
            if temp > L["temp_crit"]:
                f.append(Finding("critical", "temperature_critical", f"Temperature {temp:.1f} °C (limit {L['temp_crit']:.0f} °C)"))
            elif temp > L["temp_warn"]:
                f.append(Finding("medium", "temperature_warning", f"Temperature {temp:.1f} °C (warn {L['temp_warn']:.0f} °C)"))
            if power > L["pow_crit"]:
                f.append(Finding("critical", "power_critical", f"Power {power:.2f} kW (limit {L['pow_crit']:.1f} kW)"))
            elif power > L["pow_warn"]:
                f.append(Finding("medium", "power_warning", f"Power {power:.2f} kW (warn {L['pow_warn']:.1f} kW)"))

            apparent = volt * cur / 1000.0
            if power > apparent * 1.05 + 0.02:
                f.append(Finding("high", "power_mismatch",
                                 f"Reported {power:.2f} kW exceeds V×I = {apparent:.2f} kW (physically impossible)"))

            prev_wh = row["reported_wh"]
            if reported is not None and prev_wh is not None and reported < prev_wh - LIMITS["energy_tolerance"]:
                f.append(Finding("high", "energy_rollback",
                                 f"Cumulative energy fell from {prev_wh:.2f} Wh to {reported:.2f} Wh (meter register rolled back?)"))

            if data.get("alert") is True:
                f.append(Finding("medium", "meter_reported_alert", "Meter raised its own tamper / fault alert"))

            hist = c.execute(
                "SELECT power_kw FROM telemetry WHERE meter_id=? AND flagged=0 ORDER BY id DESC LIMIT 10",
                (meter_id,)).fetchall()
            if len(hist) >= 5:
                mean = sum(r[0] for r in hist) / len(hist)
                if power > mean * L["spike_factor"] and power - mean > L["spike_min_delta"]:
                    f.append(Finding("medium", "sudden_spike",
                                     f"Power jumped to {power:.2f} kW vs recent average {mean:.2f} kW"))

            # accept + store ----------------------------------------------------------
            dt = min(now - row["last_seen"], 10.0) if row["last_seen"] else 0.0
            energy = (row["energy_wh"] or 0.0) + power * 1000.0 * dt / 3600.0
            c.execute(
                "INSERT INTO telemetry(ts,meter_id,temp_c,voltage_v,current_a,power_kw,energy_wh,seq,flagged,raw,reported_wh) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (now, meter_id, temp, volt, cur, power, energy, seq, 1 if f else 0, raw[:2000], reported),
            )
            if reported is not None and (prev_wh is None or reported >= prev_wh - LIMITS["energy_tolerance"]):
                c.execute("UPDATE meters SET reported_wh=? WHERE meter_id=?", (reported, meter_id))
            c.execute(
                "UPDATE meters SET last_seen=?, last_seq=COALESCE(?, last_seq), energy_wh=?, accepted=accepted+1 WHERE meter_id=?",
                (now, seq, energy, meter_id),
            )
            self._bump(c, "accepted")
            v.accepted = True
            for fi in f:
                self._log_event(c, now, meter_id, fi.severity, fi.type, fi.reason, source, "flagged", raw)

            # 8. auto-isolation -------------------------------------------------------
            if f and SEV_RANK[v.severity] >= SEV_RANK["high"] and self.auto_isolate:
                st = self._strikes[meter_id]
                st.append(now)
                while st and now - st[0] > LIMITS["strike_window"]:
                    st.popleft()
                if len(st) >= self.auto_isolate_strikes:
                    self._isolate(c, meter_id, f"Auto-isolated: {len(st)} critical packets in "
                                                f"{LIMITS['strike_window']:.0f}s", "gateway", now)
                    v.isolated_now = True
        return v

    # ----------------------------------------------------------- isolation --
    def _isolate(self, c, meter_id: str, reason: str, by: str, now: float) -> None:
        c.execute("UPDATE meters SET status='isolated', isolated_reason=? WHERE meter_id=?", (reason, meter_id))
        self._log_event(c, now, meter_id, "high", "meter_isolated", reason, by, "isolated", "")
        self._strikes[meter_id].clear()

    def isolate(self, meter_id: str, reason: str = "Manually isolated by operator") -> None:
        with self._lock, self._conn() as c:
            self._addr = "operator-ui"
            self._isolate(c, meter_id, reason, "operator", time.time())

    def restore(self, meter_id: str) -> None:
        with self._lock, self._conn() as c:
            self._addr = "operator-ui"
            c.execute("UPDATE meters SET status='online', isolated_reason=NULL WHERE meter_id=?", (meter_id,))
            self._log_event(c, time.time(), meter_id, "info", "meter_restored",
                            "Meter restored to service by operator", "operator", "restored", "")
            self._strikes[meter_id].clear()

    # ------------------------------------------------------------- queries --
    @staticmethod
    def _to_local(df: pd.DataFrame) -> pd.DataFrame:
        if df.empty:
            df["dt"] = pd.to_datetime(pd.Series([], dtype="float64"))
            return df
        tz = datetime.now().astimezone().tzinfo
        df["dt"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert(tz).dt.tz_localize(None)
        return df

    def telemetry_df(self, since_seconds: float | None = None, limit: int = 4000) -> pd.DataFrame:
        q, args = "SELECT * FROM telemetry", []
        if since_seconds:
            q += " WHERE ts >= ?"
            args.append(time.time() - since_seconds)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with self._conn() as c:
            df = pd.read_sql_query(q, c, params=args)
        return self._to_local(df.iloc[::-1].reset_index(drop=True))

    def events_df(self, limit: int = 2000) -> pd.DataFrame:
        with self._conn() as c:
            df = pd.read_sql_query("SELECT * FROM events ORDER BY id DESC LIMIT ?", c, params=[limit])
        return self._to_local(df)

    def meters_state(self) -> dict[str, dict]:
        with self._conn() as c:
            rows = {r["meter_id"]: dict(r) for r in c.execute("SELECT * FROM meters")}
            latest = c.execute(
                "SELECT t.* FROM telemetry t JOIN (SELECT meter_id, MAX(id) mid FROM telemetry GROUP BY meter_id) m "
                "ON t.id = m.mid").fetchall()
        for r in latest:
            rows[r["meter_id"]]["latest"] = dict(r)
        now = time.time()
        recent = self.events_df(limit=300)
        for mid, s in rows.items():
            s.update(METERS[mid])
            s.pop("key", None)
            s.setdefault("latest", None)
            s["score"] = self._score(recent, mid, now)
            s["level"] = self._level(recent, mid, now, 20)
        return rows

    @staticmethod
    def _score(ev: pd.DataFrame, mid: str, now: float, window: float = 600) -> int:
        if ev.empty:
            return 100
        e = ev[(ev.meter_id == mid) & (ev.ts >= now - window) & (ev.action != "restored")]
        pen = 0
        for sev in e.severity:
            pen += {"critical": 12, "high": 10, "medium": 4}.get(sev, 0)
        return max(0, 100 - pen)

    @staticmethod
    def _level(ev: pd.DataFrame, mid: str, now: float, window: float) -> str:
        """none / medium / high  - worst severity seen for this meter in the window."""
        if ev.empty:
            return "none"
        e = ev[(ev.meter_id == mid) & (ev.ts >= now - window) & (ev.action.isin(["flagged", "rejected"]))]
        if e.empty:
            return "none"
        worst = max(SEV_RANK.get(s, 0) for s in e.severity)
        return "high" if worst >= 3 else "medium" if worst == 2 else "none"

    def stats(self) -> dict:
        now = time.time()
        with self._conn() as c:
            counters = {r["key"]: r["value"] for r in c.execute("SELECT * FROM counters")}
            isolated = c.execute("SELECT COUNT(*) FROM meters WHERE status='isolated'").fetchone()[0]
            online = c.execute("SELECT COUNT(*) FROM meters WHERE status='online'").fetchone()[0]
            ev = c.execute(
                "SELECT severity, action, ts FROM events WHERE action IN ('flagged','rejected')").fetchall()
        recent = [e for e in ev if e["ts"] >= now - 120]
        worst = max((SEV_RANK.get(e["severity"], 0) for e in recent), default=0)
        threat = "ATTACK" if worst >= 3 else "ELEVATED" if worst == 2 else "SECURE"
        load = sum((m["latest"] or {}).get("power_kw", 0) for m in self.meters_state().values()
                   if m["status"] == "online" and m["latest"] and now - m["latest"]["ts"] < 15)
        return dict(
            accepted=counters.get("accepted", 0), rejected=counters.get("rejected", 0),
            blocked=counters.get("blocked", 0), threats=len(ev), isolated=isolated,
            online=online, threat=threat, load_kw=load,
        )

    def last_raw(self, meter_id: str) -> str | None:
        with self._conn() as c:
            r = c.execute("SELECT raw FROM telemetry WHERE meter_id=? ORDER BY id DESC LIMIT 1", (meter_id,)).fetchone()
        return r[0] if r else None

    def last_seq(self, meter_id: str) -> int:
        with self._conn() as c:
            r = c.execute("SELECT last_seq FROM meters WHERE meter_id=?", (meter_id,)).fetchone()
        return int(r[0] or 0) if r else 0

    def last_reported_wh(self, meter_id: str) -> float:
        with self._conn() as c:
            r = c.execute("SELECT reported_wh FROM meters WHERE meter_id=?", (meter_id,)).fetchone()
        return float(r[0] or 0.0) if r else 0.0
