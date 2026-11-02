#!/usr/bin/env node
// GridGuard <-> Wokwi bridge
//
// Wokwi (VS Code) exposes each simulated ESP32's serial port as a TCP "RFC2217" server
// (see rfc2217ServerPort in wokwi.toml). This script connects to those ports, then:
//
//   Wokwi meter  --JSON line-->  bridge  --POST /api/ingest-->  GridGuard gateway
//   Wokwi meter  <--SYNC/STATE--  bridge  <--GET /api/sync/:id--  GridGuard gateway
//
// The meter signs its own packets (HMAC). The bridge never signs or edits anything:
// it only forwards what the meter printed, so the gateway judges the real device output.
//
// Usage:  npm run bridge
//         node tools/wokwi-bridge.mjs --url http://localhost:3000 --map 4000=MTR-001,4001=MTR-002

import net from 'node:net';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const GATEWAY = (args.url || process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const HOST = args.host || '127.0.0.1';
const MAP = (args.map || '4000=MTR-001,4001=MTR-002')
  .split(',')
  .map(p => p.split('='))
  .map(([port, id]) => ({ port: Number(port), meterId: id.trim() }));

const SYNC_EVERY_MS = 15000;
const POLL_EVERY_MS = 2000;

const ts = () => new Date().toTimeString().split(' ')[0];
const log = (id, msg) => console.log(`[${ts()}] ${id.padEnd(8)} ${msg}`);

async function api(path, options) {
  const res = await fetch(GATEWAY + path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

// Minimal telnet/RFC2217 filter: strips negotiation bytes, accepts BINARY + SGA, refuses the rest.
const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
function makeTelnetFilter(socket) {
  let state = 'data';
  let cmd = 0;
  return chunk => {
    let out = '';
    for (const b of chunk) {
      if (state === 'data') {
        if (b === IAC) state = 'iac';
        else out += String.fromCharCode(b);
      } else if (state === 'iac') {
        if (b === IAC) { out += String.fromCharCode(255); state = 'data'; }
        else if (b === DO || b === DONT || b === WILL || b === WONT) { cmd = b; state = 'opt'; }
        else if (b === SB) state = 'sb';
        else state = 'data';
      } else if (state === 'opt') {
        const accept = b === 0 || b === 3; // BINARY, SUPPRESS-GO-AHEAD
        if (cmd === DO) socket.write(Buffer.from([IAC, accept ? WILL : WONT, b]));
        else if (cmd === WILL) socket.write(Buffer.from([IAC, accept ? DO : DONT, b]));
        state = 'data';
      } else if (state === 'sb') {
        if (b === IAC) state = 'sb_iac';
      } else if (state === 'sb_iac') {
        state = b === SE ? 'data' : 'sb';
      }
    }
    return out;
  };
}

function startMeter({ port, meterId }) {
  let socket = null;
  let buffer = '';
  let lastSyncAt = 0;
  let lastFwSeq = 0;
  let lastState = null;
  let timer = null;

  const send = line => socket && !socket.destroyed && socket.write(line + '\n');

  async function sync(reason, claim = false) {
    try {
      const s = await api(`/api/sync/${meterId}${claim ? '?claim=1' : ''}`);
      send(`SYNC ${s.epoch} ${s.last_seq} ${Number(s.reported_wh).toFixed(2)}`);
      lastSyncAt = Date.now();
      log(meterId, `sync sent (${reason}): seq>=${s.last_seq}, energy>=${Number(s.reported_wh).toFixed(2)} Wh`);
    } catch (e) {
      log(meterId, `gateway unreachable for sync: ${e.message}`);
    }
  }

  async function poll() {
    try {
      const s = await api(`/api/sync/${meterId}`);
      const state = s.status === 'isolated' ? 'ISOLATED' : 'ONLINE';
      if (state !== lastState) {
        send(`STATE ${state}`);
        lastState = state;
        log(meterId, `gateway state -> ${state}`);
      }
      // Gateway moved ahead of the meter (e.g. Attack Lab used sequence numbers) or time to refresh the clock.
      if (s.last_seq > lastFwSeq || Date.now() - lastSyncAt > SYNC_EVERY_MS) {
        await sync(s.last_seq > lastFwSeq ? 'gateway ahead' : 'periodic');
      }
    } catch {
      /* gateway restarting; try again next tick */
    }
  }

  async function forward(line) {
    let seq = 0;
    try { seq = Number(JSON.parse(line).seq) || 0; } catch { /* gateway will report malformed JSON */ }
    if (seq) lastFwSeq = seq;
    try {
      const v = await api('/api/ingest', {
        method: 'POST',
        body: JSON.stringify({ packet: line, source: 'serial', addr: `wokwi:${meterId}@${port}` }),
      });
      const why = v.findings?.length ? ' · ' + v.findings.map(f => f.type).join(', ') : '';
      const tag = v.mitm ? `  <-- MITM: ${v.mitm.label}` : '';
      log(meterId, `${String(v.label).padEnd(8)} seq=${seq || '-'}${why}${tag}`);
    } catch (e) {
      log(meterId, `could not reach gateway: ${e.message}`);
    }
  }

  function connect() {
    socket = net.connect(port, HOST);
    const filter = makeTelnetFilter(socket);

    socket.on('connect', () => {
      log(meterId, `connected to Wokwi serial on ${HOST}:${port}`);
      buffer = '';
      lastState = null;
      lastFwSeq = 0;
      sync('connect', true);
      timer = setInterval(poll, POLL_EVERY_MS);
    });

    socket.on('data', chunk => {
      buffer += filter(chunk);
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).replace(/\r/g, '').trim();
        buffer = buffer.slice(i + 1);
        if (line.startsWith('{') && line.endsWith('}')) forward(line);
        else if (line) log(meterId, `meter: ${line}`);
      }
    });

    const retry = () => {
      clearInterval(timer);
      socket.destroy();
      setTimeout(connect, 3000);
    };
    let warned = false;
    socket.on('error', e => {
      if (!warned) {
        log(meterId, `waiting for Wokwi on port ${port} (start the simulation: F1 -> "Wokwi: Start Simulator") [${e.code || e.message}]`);
        warned = true;
      }
    });
    socket.on('close', () => { retry(); });
  }

  connect();
}

console.log(`GridGuard Wokwi bridge -> ${GATEWAY}`);
MAP.forEach(m => console.log(`  ${m.meterId} <- Wokwi serial ${HOST}:${m.port}`));
console.log('');
MAP.forEach(startMeter);
