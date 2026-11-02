import assert from 'node:assert/strict';
import { GridGuardEngine, METERS_REGISTRY, signHmac } from '../src/server/engine.js';

function packet(meter_id: string, seq: number, changes: Record<string, unknown> = {}) {
  const data = { meter_id, seq, ts: Date.now() / 1000, temp_c: 28,
    voltage_v: 230, current_a: 1, power_kw: 0.23, energy_wh: 10,
    alert: false, source: 'arduino-live', ...changes };
  return { ...data, hmac: signHmac(data, METERS_REGISTRY[meter_id].key) };
}
for (const id of ['MTR-001', 'MTR-002']) {
  const engine = new GridGuardEngine();
  engine.strict_hmac = true;
  engine.ingest(packet(id, 500), 'simulator');
  assert.ok(engine.ingest(packet(id, 1), 'arduino').findings.some(f => f.type === 'replay_detected'));
  assert.equal(engine.startHardwareSession(id, 'simulator'), false);
  assert.equal(engine.startHardwareSession('toString', 'arduino-live'), false);
  assert.equal(engine.getLastSeq(id), 500);
  const history = engine.getTelemetry().length;
  assert.equal(engine.startHardwareSession(id, 'arduino-live'), true);
  assert.equal(engine.getLastSeq(id), 0);
  assert.equal(engine.getLastReportedWh(id), 10);
  assert.equal(engine.getTelemetry().length, history);
  assert.equal(engine.getMetersState()[id].rejected, 1);
  assert.equal(engine.isLive(id), true);
  for (const [changes, reason] of [
    [{ hmac: 'invalid' }, 'invalid_hmac'],
    [{ ts: 1 }, 'stale_timestamp'],
    [{ voltage_v: 2000 }, 'impossible_reading'],
  ] as const) {
    const data = packet(id, 1, changes);
    if ('hmac' in changes) data.hmac = changes.hmac;
    assert.ok(engine.ingest(data, 'arduino').findings.some(f => f.type === reason));
    assert.equal(engine.getLastSeq(id), 0);
  }
  assert.equal(engine.ingest(packet(id, 1), 'arduino').accepted, true);
  assert.equal(engine.ingest(packet(id, 2), 'arduino').accepted, true);
  assert.ok(engine.ingest(packet(id, 2), 'arduino').findings.some(f => f.type === 'replay_detected'));
  // A handshake must not reset accumulated rate limits.
  engine.startHardwareSession(id, 'arduino-live');
  assert.ok(engine.ingest(packet(id, 1), 'arduino').findings.some(f => f.type === 'message_flood'));

  // Repeated boots work without resetting the gateway.
  const boots = new GridGuardEngine();
  for (let boot = 0; boot < 3; boot++) {
    assert.equal(boots.startHardwareSession(id, 'arduino-live'), true);
    assert.equal(boots.ingest(packet(id, 1), 'arduino').accepted, true);
    assert.ok(boots.ingest(packet(id, 1), 'arduino').findings.some(f => f.type === 'replay_detected'));
  }
  boots.isolate(id, 'test isolation');
  boots.startHardwareSession(id, 'arduino-live');
  assert.equal(boots.getSyncInfo(id)!.status, 'isolated');
  assert.equal(boots.ingest(packet(id, 1), 'arduino').blocked, true);
  const event = boots.getEvents().find(e => e.type === 'hardware_session_sync')!;
  assert.equal(event.severity, 'info');
  assert.equal(event.reason, 'Arduino hardware sequence state synchronized');
  for (const source of ['simulator', 'serial', 'wokwi']) {
    const other = new GridGuardEngine();
    other.ingest(packet(id, 500), 'simulator');
    assert.ok(other.ingest(packet(id, 1), source).findings.some(f => f.type === 'replay_detected'));
  }
}
console.log('Hardware handshake and replay regression checks passed.');
