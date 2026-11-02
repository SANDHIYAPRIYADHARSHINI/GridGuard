import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GridGuardEngine } from './src/server/engine.js';
import { tickSimulator, runAttackScenario, ATTACKS_CATALOG, runMitmSimulation } from './src/server/simulator.js';
import { LiveMitm, LIVE_MITM_ATTACKS } from './src/server/liveMitm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let PORT = 3000;
const portIdx = process.argv.indexOf('--port');
if (portIdx !== -1 && process.argv[portIdx + 1]) {
  const p = parseInt(process.argv[portIdx + 1], 10);
  if (!isNaN(p) && p !== 8080) PORT = p;
} else if (process.env.DEFAULT_APP_PORT) {
  PORT = parseInt(process.env.DEFAULT_APP_PORT, 10);
}
const engine = new GridGuardEngine();
const liveMitm = new LiveMitm();

let simOn = true; // Default ON so meters show live data immediately
let autoRefresh = true;
let refreshInterval = 2;

// Background simulator loop
setInterval(() => {
  if (simOn) {
    try {
      tickSimulator(engine, 1.8);
    } catch (err) {
      console.error('Simulator tick error:', err);
    }
  }
}, 1000);

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
  } }));
  app.use(express.urlencoded({ extended: true }));

  // Seed initial normal readings so the dashboard is populated on first load
  try {
    for (let i = 0; i < 5; i++) {
      tickSimulator(engine, 0);
    }
  } catch (e) {
    console.error('Initial simulator seed error:', e);
  }

  // API Routes
  app.get('/api/time', (_req, res) => {
    res.type('text/plain').send(String(Math.floor(Date.now() / 1000)));
  });

  app.post('/api/session/start', (req, res) => {
    const { meter_id, source } = req.body || {};
    if (typeof meter_id !== 'string' || !engine.getSyncInfo(meter_id)) {
      return res.status(400).json({ error: 'Unknown meter' });
    }
    if (source !== 'arduino-live') {
      return res.status(400).json({ error: 'Session source must be arduino-live' });
    }
    engine.startHardwareSession(meter_id, source, req.ip);
    res.json({ verdict: 'SESSION_STARTED', meter_id,
      meter_status: engine.getSyncInfo(meter_id)!.status });
  });

  app.post('/api/telemetry', (req, res) => {
    // Preserve decimal tokens: the board signs exactly the JSON it sends.
    const raw = (req as express.Request & { rawBody?: string }).rawBody || '';
    const result = engine.ingest(raw, 'arduino', req.ip);
    const status = result.meter_id ? engine.getSyncInfo(result.meter_id)?.status : undefined;
    res.json({
      verdict: status === 'isolated' ? 'ISOLATED' : result.label,
      reason: result.findings.map(f => f.type).join(', ') ||
        (status === 'isolated' ? 'Meter isolated' : 'Packet accepted'),
      meter_status: status || 'unregistered',
    });
  });
  app.get('/api/status', (req, res) => {
    res.json(engine.getStats());
  });

  app.get('/api/meters', (req, res) => {
    res.json(engine.getMetersState());
  });

  app.get('/api/telemetry', (req, res) => {
    const since = req.query.since ? Number(req.query.since) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 4000;
    res.json(engine.getTelemetry(since, limit));
  });

  app.get('/api/events', (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 2000;
    res.json(engine.getEvents(limit));
  });

  app.post('/api/ingest', (req, res) => {
    const { packet, source = 'serial-paste', addr = 'pasted-line' } = req.body;
    if (!packet) {
      return res.status(400).json({ error: 'Missing packet' });
    }
    // Live meters (via the Wokwi bridge) go through the on-path attacker first.
    if (source === 'serial' && typeof packet === 'string') {
      const plan = liveMitm.intercept(packet);
      if (!plan.attack) {
        return res.json({ ...engine.ingest(packet, source, addr), mitm: null });
      }
      const tag = `mitm[${plan.attack}]:${addr}`;
      const verdicts = plan.deliver.map(raw => engine.ingest(raw, source, tag));
      // The interesting verdict is the attacker's packet: last one delivered.
      const v = verdicts[verdicts.length - 1];
      liveMitm.record(plan, v);
      return res.json({ ...v, mitm: { attack: plan.attack, label: plan.label, delivered: verdicts.length } });
    }
    const verdict = engine.ingest(packet, source, addr);
    res.json(verdict);
  });

  app.get('/api/live-mitm', (req, res) => {
    res.json(liveMitm.status());
  });

  // "Strike now": attack the next live packet (optionally from one meter), even if the
  // automatic attacker is switched off.
  app.post('/api/live-mitm/strike', (req, res) => {
    const { attack = 'auto', meter = null, cancel = false } = req.body || {};
    if (cancel) {
      liveMitm.disarm();
    } else {
      if (attack !== 'auto' && !LIVE_MITM_ATTACKS.some(a => a.key === attack)) {
        return res.status(400).json({ error: 'Unknown attack' });
      }
      liveMitm.arm(attack, meter || null);
    }
    res.json(liveMitm.status());
  });

  app.post('/api/live-mitm/clear', (req, res) => {
    liveMitm.clearLog();
    res.json(liveMitm.status());
  });

  // Used by tools/wokwi-bridge.mjs: clock, last accepted sequence and energy for a meter,
  // so a freshly started ESP32 can continue from where the gateway expects it.
  app.get('/api/sync/:id', (req, res) => {
    const info = engine.getSyncInfo(req.params.id);
    if (!info) return res.status(404).json({ error: 'Unknown meter' });
    if (req.query.claim === '1') engine.claimLive(req.params.id, req.query.source === 'arduino' ? 'arduino' : 'wokwi');
    res.json(info);
  });

  app.post('/api/attack', (req, res) => {
    const { kind, target = 'MTR-002' } = req.body;
    if (!kind) {
      return res.status(400).json({ error: 'Missing attack kind' });
    }
    try {
      const result = runAttackScenario(engine, kind, target);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/mitm/simulate', (req, res) => {
    const { mode = 'attack', target = 'MTR-002', tamperField, scenarioKey } = req.body || {};
    const key = scenarioKey || tamperField || 'current_power';
    try {
      const result = runMitmSimulation(engine, mode, target, key);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/attacks-catalog', (req, res) => {
    res.json(ATTACKS_CATALOG);
  });

  app.post('/api/meters/:id/isolate', (req, res) => {
    const { id } = req.params;
    const { reason = 'Manually isolated by operator' } = req.body || {};
    engine.isolate(id, reason);
    res.json({ success: true, message: `Meter ${id} isolated` });
  });

  app.post('/api/meters/:id/restore', (req, res) => {
    const { id } = req.params;
    engine.restore(id);
    res.json({ success: true, message: `Meter ${id} restored` });
  });

  app.post('/api/reset', (req, res) => {
    engine.reset();
    liveMitm.reset();
    // seed initial points again
    for (let i = 0; i < 3; i++) {
      tickSimulator(engine, 0);
    }
    res.json({ success: true });
  });

  app.get('/api/settings', (req, res) => {
    res.json({
      auto_isolate: engine.auto_isolate,
      strict_hmac: engine.strict_hmac,
      sim_on: simOn,
      auto_refresh: autoRefresh,
      refresh_interval: refreshInterval,
      live_mitm_on: liveMitm.enabled,
      live_mitm_mode: liveMitm.mode,
      live_mitm_rate: liveMitm.rate,
    });
  });

  app.post('/api/settings', (req, res) => {
    const { auto_isolate, strict_hmac, sim_on, auto_refresh, refresh_interval, live_mitm_on, live_mitm_mode, live_mitm_rate } = req.body;
    if (auto_isolate !== undefined) engine.auto_isolate = Boolean(auto_isolate);
    if (strict_hmac !== undefined) engine.strict_hmac = Boolean(strict_hmac);
    if (sim_on !== undefined) simOn = Boolean(sim_on);
    if (auto_refresh !== undefined) autoRefresh = Boolean(auto_refresh);
    if (refresh_interval !== undefined) refreshInterval = Math.max(1, Math.min(10, Number(refresh_interval)));
    if (live_mitm_on !== undefined) liveMitm.enabled = Boolean(live_mitm_on);
    if (live_mitm_mode !== undefined && (live_mitm_mode === 'auto' || LIVE_MITM_ATTACKS.some(a => a.key === live_mitm_mode))) liveMitm.mode = live_mitm_mode;
    if (live_mitm_rate !== undefined) liveMitm.rate = Math.max(0.05, Math.min(1, Number(live_mitm_rate)));

    res.json({
      auto_isolate: engine.auto_isolate,
      strict_hmac: engine.strict_hmac,
      sim_on: simOn,
      auto_refresh: autoRefresh,
      refresh_interval: refreshInterval,
      live_mitm_on: liveMitm.enabled,
      live_mitm_mode: liveMitm.mode,
      live_mitm_rate: liveMitm.rate,
    });
  });

  // CSV export endpoints
  app.get('/api/export/events.csv', (req, res) => {
    const events = engine.getEvents(5000);
    const headers = ['id', 'time', 'meter_id', 'severity', 'type', 'reason', 'action', 'source', 'addr', 'meter_state'];
    const rows = events.map(e => [
      e.id,
      e.timeStr,
      `"${(e.meter_id || '').replace(/"/g, '""')}"`,
      e.severity,
      `"${(e.type || '').replace(/"/g, '""')}"`,
      `"${(e.reason || '').replace(/"/g, '""')}"`,
      e.action,
      `"${(e.source || '').replace(/"/g, '""')}"`,
      `"${(e.addr || '').replace(/"/g, '""')}"`,
      `"${(e.meter_state || '').replace(/"/g, '""')}"`,
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="gridguard_events.csv"');
    res.send(csv);
  });

  app.get('/api/export/telemetry.csv', (req, res) => {
    const telemetry = engine.getTelemetry(undefined, 5000);
    const headers = ['id', 'time', 'meter_id', 'voltage_v', 'current_a', 'power_kw', 'temp_c', 'energy_wh', 'seq', 'flagged', 'reported_wh', 'source'];
    const rows = telemetry.map(t => [
      t.id,
      t.timeStr,
      `"${t.meter_id}"`,
      t.voltage_v.toFixed(1),
      t.current_a.toFixed(2),
      t.power_kw.toFixed(2),
      t.temp_c.toFixed(1),
      t.energy_wh.toFixed(2),
      t.seq ?? '',
      t.flagged ? 1 : 0,
      t.reported_wh !== null ? t.reported_wh.toFixed(2) : '',
      `"${(t.source || '').replace(/"/g, '""')}"`,
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="gridguard_telemetry.csv"');
    res.send(csv);
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      if (req.method !== 'GET') return next();
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`GridGuard server running on http://0.0.0.0:${PORT}`);
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
  });

  const cleanup = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
