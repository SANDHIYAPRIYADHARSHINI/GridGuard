"""Run with:  python -m pytest -q   (from the repo root)"""
import sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from gateway.core import GridGuardEngine, METERS
from gateway.simulator import format_packet, run_attack, normal_packet


@pytest.fixture()
def eng(tmp_path):
    return GridGuardEngine(tmp_path / "t.db")


def send(eng, mid="MTR-001", **kw):
    args = dict(seq=eng.last_seq(mid) + 1, temp=28.0, volt=230.0, cur=1.2)
    args.update(kw)
    return eng.ingest(format_packet(mid, **args))


def types(v):
    return {f.type for f in v.findings}


def test_valid_signed_packet_is_accepted(eng):
    v = send(eng)
    assert v.accepted and v.authenticated is True and not v.findings


def test_unknown_meter_rejected_critical(eng):
    v = eng.ingest(format_packet("MTR-999", 1, 28, 230, 1.2, key="x"))
    assert not v.accepted and v.severity == "critical" and "unauthorized_device" in types(v)


def test_tampered_message_fails_hmac(eng):
    v = eng.ingest(format_packet("MTR-001", 1, 28, 230, 1.2, tamper_after_signing=True))
    assert not v.accepted and "invalid_hmac" in types(v)


def test_wrong_key_fails_hmac(eng):
    v = eng.ingest(format_packet("MTR-001", 1, 28, 230, 1.2, key="not-the-key"))
    assert "invalid_hmac" in types(v)


def test_replay_rejected(eng):
    send(eng)
    raw = eng.last_raw("MTR-001")
    v = eng.ingest(raw)
    assert not v.accepted and "replay_detected" in types(v)


def test_stale_timestamp_rejected(eng):
    v = send(eng, ts=time.time() - 300)
    assert not v.accepted and "stale_timestamp" in types(v)


def test_legacy_unsigned_allowed_unless_strict(eng):
    line = '{"meter_id":"MTR-001","temp_c":28.0,"voltage_v":230.0,"current_a":1.2,"power_kw":0.28,"alert":false}'
    v = eng.ingest(line)
    assert v.accepted and v.authenticated is False
    eng.strict_hmac = True
    v = eng.ingest(line)
    assert not v.accepted and "hmac_missing" in types(v)


def test_review1_scenarios(eng):
    # scenario 1 -> suspicious (medium), scenario 2 -> clear anomaly (critical)
    v1 = send(eng, temp=35, volt=235, cur=4.0)
    assert v1.accepted and v1.severity == "medium"
    v2 = send(eng, temp=45, volt=250, cur=9.5)
    assert v2.accepted and v2.severity == "critical"


def test_impossible_reading_rejected(eng):
    v = send(eng, volt=9999)
    assert not v.accepted and "impossible_reading" in types(v)


def test_power_mismatch(eng):
    v = send(eng, power=5.0)
    assert "power_mismatch" in types(v)


def test_meter_alert_flag_is_honoured(eng):
    v = send(eng, alert=True)
    assert "meter_reported_alert" in types(v)


def test_flood_triggers_rate_limit(eng):
    out = [send(eng) for _ in range(12)]
    assert any("message_flood" in types(v) for v in out)


def test_auto_isolation_only_hits_offender(eng):
    for _ in range(3):
        send(eng, "MTR-002", temp=78, volt=262, cur=14.5)
    st = eng.meters_state()
    assert st["MTR-002"]["status"] == "isolated" and st["MTR-001"]["status"] == "online"
    assert send(eng, "MTR-002").blocked            # isolated meter is ignored...
    assert send(eng, "MTR-001").accepted           # ...healthy meter still works


def test_restore(eng):
    eng.isolate("MTR-001")
    eng.restore("MTR-001")
    assert send(eng).accepted


def test_spoofed_packets_cannot_get_a_healthy_meter_isolated(eng):
    for _ in range(5):
        eng.ingest(format_packet("MTR-001", 1, 28, 230, 1.2, key="attacker"))
    assert eng.meters_state()["MTR-001"]["status"] == "online"


@pytest.mark.parametrize("kind", ["unauthorized", "invalid_hmac", "replay", "tamper", "flood", "normal"])
def test_attack_lab_runs(eng, kind):
    assert run_attack(eng, kind, "MTR-002")


def test_malformed_json(eng):
    assert "malformed_json" in types(eng.ingest("not json {"))


# ---- energy register, source address, event state, DB migration -------------------------
def test_energy_rollback_flagged(eng):
    assert send(eng, energy_wh=10.0).accepted
    v = send(eng, energy_wh=4.0)
    assert v.accepted and "energy_rollback" in types(v) and v.severity == "high"
    assert "energy_rollback" not in types(send(eng, energy_wh=10.5))   # register recovers, no repeat alarm


def test_energy_increase_and_absent_energy_are_fine(eng):
    assert not send(eng, energy_wh=1.0).findings
    assert not send(eng, energy_wh=2.0).findings
    assert not send(eng).findings                                      # legacy packet without energy_wh


def test_bad_energy_value_rejected(eng):
    v = eng.ingest('{"meter_id":"MTR-001","temp_c":28.0,"voltage_v":230.0,"current_a":1.2,"energy_wh":"abc"}')
    assert not v.accepted and "malformed_packet" in types(v)


def test_events_store_source_address_and_meter_state(eng):
    eng.ingest(format_packet("MTR-999", 1, 28, 230, 1.2, key="x"), source="mqtt", addr="mqtt:broker/topic-1")
    eng.isolate("MTR-001")
    ev = eng.events_df()
    rogue = ev[ev.type == "unauthorized_device"].iloc[0]
    assert rogue.addr == "mqtt:broker/topic-1" and rogue.meter_state == "unregistered"
    iso = ev[ev.type == "meter_isolated"].iloc[0]
    assert iso.meter_state == "isolated" and iso.addr == "operator-ui"


def test_old_database_is_migrated(tmp_path):
    import sqlite3
    db = tmp_path / "old.db"
    c = sqlite3.connect(db)
    c.executescript("""
        CREATE TABLE telemetry(id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, meter_id TEXT, temp_c REAL, voltage_v REAL,
            current_a REAL, power_kw REAL, energy_wh REAL, seq INTEGER, flagged INTEGER, raw TEXT);
        CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, meter_id TEXT, severity TEXT, type TEXT,
            reason TEXT, source TEXT, action TEXT, raw TEXT);
        CREATE TABLE meters(meter_id TEXT PRIMARY KEY, status TEXT, last_seen REAL, last_seq INTEGER, energy_wh REAL,
            accepted INTEGER, rejected INTEGER, blocked INTEGER, isolated_reason TEXT);
        CREATE TABLE counters(key TEXT PRIMARY KEY, value INTEGER);""")
    c.commit(); c.close()
    e = GridGuardEngine(db)
    assert e.ingest(format_packet("MTR-001", 1, 28, 230, 1.2, energy_wh=1.0)).accepted
    e.ingest(format_packet("MTR-999", 1, 28, 230, 1.2, key="x"))
    assert not e.events_df().empty


def test_energy_rollback_attack_button(eng):
    out = run_attack(eng, "energy_rollback", "MTR-002")
    assert any("energy_rollback" in types(v) for _, v in out)
