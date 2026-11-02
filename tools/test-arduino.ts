import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { GridGuardEngine } from '../src/server/engine.js';
import { formatPacket, tickSimulator } from '../src/server/simulator.js';

// Verify per-meter handoff/fallback without waiting eight real seconds.
const engine = new GridGuardEngine();
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
try {
  tickSimulator(engine, 0);
  engine.claimLive('MTR-001', 'arduino');
  const aSeq = engine.getLastSeq('MTR-001');
  const bSeq = engine.getLastSeq('MTR-002');
  now += 2000;
  tickSimulator(engine, 0);
  assert.equal(engine.getLastSeq('MTR-001'), aSeq);
  assert.ok(engine.getLastSeq('MTR-002') > bSeq);
  assert.equal(engine.getMetersState()['MTR-001'].data_source, 'arduino');
  now += 9000;
  tickSimulator(engine, 0);
  assert.ok(engine.getLastSeq('MTR-001') > aSeq);
  assert.equal(engine.getMetersState()['MTR-001'].data_source, 'simulator');
} finally { Date.now = originalNow; }

// Exercise actual HTTP parsing: toFixed decimals must survive Express JSON parsing.
const port = 31987;
const base = `http://127.0.0.1:${port}`;
const serverArgs = process.env.GRIDGUARD_TEST_SERVER
  ? [process.env.GRIDGUARD_TEST_SERVER]
  : ['--import', 'tsx', 'server.ts'];
const child = spawn(process.execPath, [...serverArgs, '--port', String(port)], {
  env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe',
});
let output = '';
child.stdout.on('data', chunk => output += chunk);
child.stderr.on('data', chunk => output += chunk);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${base}/api/time`)).ok; } catch { /* starting */ }
    if (ready) break;
    if (child.exitCode !== null) throw new Error(output);
    await delay(100);
  }
  assert.ok(ready, output || 'Server startup timed out');
  const time = await fetch(`${base}/api/time`);
  assert.match(time.headers.get('content-type') || '', /text\/plain/);
  assert.ok(Math.abs(Number(await time.text()) - Date.now() / 1000) < 3);
  const startSession = (meter_id: unknown, source: unknown = 'arduino-live') => fetch(`${base}/api/session/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meter_id, source }),
  });
  for (const id of ['MTR-999', 'toString', null]) {
    assert.equal((await startSession(id)).status, 400);
  }
  assert.equal((await startSession('MTR-001', 'wokwi')).status, 400);
  // Claim both feeds and let startup simulator packets leave the rate window.
  for (const id of ['MTR-001', 'MTR-002']) {
    await fetch(`${base}/api/sync/${id}?claim=1&source=arduino`);
  }
  await delay(5100);
  for (const id of ['MTR-001', 'MTR-002']) {
    const sync = await (await fetch(`${base}/api/sync/${id}?claim=1&source=arduino`)).json();
    const raw = formatPacket(id, sync.last_seq + 1, 28, 230, 1.25, {
      ts: Math.floor(Date.now() / 1000), energy_wh: sync.reported_wh + 0.2,
    });
    const post = async (body: string) => (await fetch(`${base}/api/telemetry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })).json();
    assert.equal((await post(raw)).verdict, 'ACCEPTED');
    const meters = await (await fetch(`${base}/api/meters`)).json();
    assert.equal(meters[id].data_source, 'arduino');
    assert.equal((await post(raw)).reason, 'replay_detected');
    const tampered = JSON.parse(raw);
    tampered.seq += 1;
    tampered.hmac = '0'.repeat(64);
    const rejected = await post(JSON.stringify(tampered));
    assert.equal(rejected.verdict, 'REJECTED');
    assert.equal(rejected.reason, 'invalid_hmac');
    assert.equal(rejected.meter_status, 'online');
    for (let boot = 0; boot < 2; boot++) {
      const started = await startSession(id);
      assert.equal(started.status, 200);
      assert.deepEqual(await started.json(), {
        verdict: 'SESSION_STARTED', meter_id: id, meter_status: 'online',
      });
      const fresh = formatPacket(id, 1, 28, 230, 1.25, {
        ts: Math.floor(Date.now() / 1000), energy_wh: sync.reported_wh + 0.2,
      });
      assert.equal((await post(fresh)).verdict, 'ACCEPTED');
      assert.equal((await post(fresh)).reason, 'replay_detected');
    }
  }
  // Unknown identities still go through the engine allow-list.
  const unknown = { meter_id: 'MTR-999', seq: 1 };
  const result = await (await fetch(`${base}/api/telemetry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(unknown),
  })).json();
  assert.equal(result.reason, 'unauthorized_device');
  console.log('Arduino HTTP, raw HMAC, replay, allow-list and simulator handoff checks passed.');
} finally { child.kill(); }
