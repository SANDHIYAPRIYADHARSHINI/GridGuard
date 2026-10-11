"""
Packet generator for GridGuard: realistic "healthy meter" traffic plus the safe,
simulated attack scenarios from the README. Everything here only talks to the
in-process engine - nothing touches a real network or device.
"""
from __future__ import annotations

import json
import math
import random
import time

from gateway.core import METERS, GridGuardEngine, Verdict, sign

# Per-meter "personality" so the two live charts do not overlap perfectly.
PROFILE = {
    "MTR-001": dict(cur=1.25, cur_amp=0.35, temp=28.0, phase=0.0),
    "MTR-002": dict(cur=1.70, cur_amp=0.45, temp=29.5, phase=2.1),
}

ATTACKS = {
    "unauthorized": dict(title="Unauthorized Meter",
                         desc="A rogue device (MTR-999) tries to inject telemetry.",
                         expect="Rejected · critical alert"),
    "invalid_hmac": dict(title="Tampered Message",
                         desc="A valid packet is altered in transit (current edited) so its signature no longer matches.",
                         expect="Rejected · HMAC mismatch"),
    "replay": dict(title="Replay Attack",
                   desc="An earlier genuine packet is captured and re-sent verbatim.",
                   expect="Rejected · sequence already used"),
    "tamper": dict(title="Compromised Meter",
                   desc="A meter with a valid key starts reporting extreme values (burst of 3 packets).",
                   expect="Flagged · auto-isolation"),
    "energy_rollback": dict(title="Energy Rollback",
                            desc="A meter's cumulative energy register suddenly goes backwards (under-billing tamper).",
                            expect="Flagged · energy rollback"),
    "flood": dict(title="Message Flood",
                  desc="A meter transmits far above its allowed rate (15 packets in a burst).",
                  expect="Rate-limit alert"),
}


def format_packet(meter_id: str, seq: int, temp: float, volt: float, cur: float,
                  power: float | None = None, alert: bool = False, key: str | None = "auto",
                  ts: float | None = None, tamper_after_signing: bool = False,
                  energy_wh: float | None = None) -> str:
    """Build the exact JSON text a firmware would print, signed over the printed tokens."""
    power = volt * cur / 1000.0 if power is None else power
    d = {
        "meter_id": meter_id,
        "seq": str(seq),
        "ts": str(int(ts if ts is not None else time.time())),
        "temp_c": f"{temp:.1f}",
        "voltage_v": f"{volt:.1f}",
        "current_a": f"{cur:.2f}",
        "power_kw": f"{power:.2f}",
        "alert": alert,
    }
    if energy_wh is not None:
        d["energy_wh"] = f"{energy_wh:.2f}"
    if key == "auto":
        key = METERS.get(meter_id, {}).get("key")
    if key:
        d["hmac"] = sign(d, key)
    if tamper_after_signing:               # attacker edits the value after the signature was made
        d["current_a"] = f"{float(d['current_a']) * 0.1:.2f}"
    # numbers unquoted like the real firmware prints them
    parts = []
    for k, val in d.items():
        if k in ("meter_id", "hmac"):
            parts.append(f'"{k}":"{val}"')
        elif isinstance(val, bool):
            parts.append(f'"{k}":{"true" if val else "false"}')
        else:
            parts.append(f'"{k}":{val}')
    return "{" + ",".join(parts) + "}"


def healthy_reading(meter_id: str, t: float | None = None) -> tuple[float, float, float]:
    t = time.time() if t is None else t
    p = PROFILE.get(meter_id, PROFILE["MTR-001"])
    cur = p["cur"] + p["cur_amp"] * math.sin(t / 18 + p["phase"]) + random.gauss(0, 0.05)
    volt = 230 + 2.2 * math.sin(t / 31 + p["phase"]) + random.gauss(0, 0.5)
    temp = p["temp"] + 1.6 * math.sin(t / 47 + p["phase"]) + random.gauss(0, 0.15)
    return temp, volt, max(0.1, cur)


def normal_packet(engine: GridGuardEngine, meter_id: str) -> str:
    temp, volt, cur = healthy_reading(meter_id)
    kwh_step = volt * cur / 1000.0 * 1000.0 * 2 / 3600.0            # Wh used in one 2 s interval
    return format_packet(meter_id, engine.last_seq(meter_id) + 1, temp, volt, cur,
                         energy_wh=engine.last_reported_wh(meter_id) + kwh_step)


def tick(engine: GridGuardEngine, min_interval: float = 1.8) -> list[Verdict]:
    """One heartbeat from every meter (rate-limited so UI reruns cannot flood the gateway)."""
    out, now = [], time.time()
    for mid in METERS:
        if now - engine.sim_last.get(mid, 0) >= min_interval:
            engine.sim_last[mid] = now
            out.append(engine.ingest(normal_packet(engine, mid), source="simulator", addr=f"sim:{mid}"))
    return out


# --------------------------------------------------------------------------- attacks
def run_attack(engine: GridGuardEngine, kind: str, target: str = "MTR-002") -> list[tuple[str, Verdict]]:
    """Run one safe attack simulation. Returns [(description, verdict), ...]."""
    res: list[tuple[str, Verdict]] = []

    def send(desc: str, pkt: str):
        res.append((desc, engine.ingest(pkt, source="attack-lab", addr="lab-attacker" if kind in ("unauthorized", "invalid_hmac", "replay", "flood") else f"lab:{target}")))

    if kind == "unauthorized":
        send("Rogue device MTR-999 → telemetry",
             format_packet("MTR-999", 1, 28.0, 230.0, 1.2, key="attacker-guess"))
    elif kind == "invalid_hmac":
        t, v, c = healthy_reading(target)
        send(f"{target} packet edited after signing",
             format_packet(target, engine.last_seq(target) + 1, t, v, max(c, 1.0), tamper_after_signing=True))
    elif kind == "replay":
        raw = engine.last_raw(target)
        if raw is None:
            send(f"{target} genuine packet (captured)", normal_packet(engine, target))
            raw = engine.last_raw(target)
        send(f"{target} captured packet re-sent verbatim", raw)
    elif kind == "tamper":
        for i in range(3):
            seq = engine.last_seq(target) + 1
            power = 6.0 if i == 2 else None        # last packet also lies about power
            send(f"{target} extreme reading #{i + 1}",
                 format_packet(target, seq, 78.0 + i, 262.0, 14.5, power=power))
            time.sleep(0.05)
    elif kind == "flood":
        burst = []
        for _ in range(15):
            t, v, c = healthy_reading(target)
            burst.append(engine.ingest(
                format_packet(target, engine.last_seq(target) + 1, t, v, c), source="attack-lab", addr="lab-attacker"))
        ok = [b for b in burst if b.accepted]
        bad = [b for b in burst if not b.accepted]
        if ok:
            res.append((f"{len(ok)} burst packets accepted before the limit was hit", ok[-1]))
        if bad:
            res.append(("First packet over the limit", bad[0]))
            res.append((f"{len(bad)} packets dropped in total", bad[-1]))
    elif kind == "energy_rollback":
        send(f"{target} normal reading (energy register counting up)", normal_packet(engine, target))
        prev = engine.last_reported_wh(target)
        t, v, c = healthy_reading(target)
        send(f"{target} reports energy {prev * 0.2:.2f} Wh after {prev:.2f} Wh",
             format_packet(target, engine.last_seq(target) + 1, t, v, c, energy_wh=prev * 0.2))
    elif kind == "normal":
        send(f"{target} healthy packet", normal_packet(engine, target))
    else:
        raise ValueError(kind)
    return res


def pretty(pkt: str) -> str:
    try:
        return json.dumps(json.loads(pkt), indent=2)
    except Exception:
        return pkt
