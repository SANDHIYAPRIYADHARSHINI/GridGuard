import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  GridStats,
  MeterInfo,
  TelemetryPoint,
  SecurityEvent,
  GatewaySettings,
  AttackResult,
  Verdict,
  MitmSimulationResult,
  MitmScenarioKey,
  LiveMitmStatus,
} from './types.js';
import { OverviewPage } from './components/OverviewPage.js';
import { LiveInterceptionPage } from './components/LiveInterceptionPage.js';
import { AlertsPage } from './components/AlertsPage.js';
import { MetersPage } from './components/MetersPage.js';
import { AttackSimulationPage } from './components/AttackSimulationPage.js';
import { ReportsPage } from './components/ReportsPage.js';
import {
  LayoutDashboard,
  Bell,
  Cpu,
  FlaskConical,
  FileSpreadsheet,
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertOctagon,
  RefreshCw,
  Sliders,
  Radio,
  Crosshair,
} from 'lucide-react';

const PAGES = ['Overview', 'Alerts', 'Meters', 'Live interception', 'Attack simulation', 'Reports'] as const;
type PageType = (typeof PAGES)[number];

export default function App() {
  const [activePage, setActivePage] = useState<PageType>('Overview');
  const [stats, setStats] = useState<GridStats>({
    accepted: 0,
    rejected: 0,
    blocked: 0,
    threats: 0,
    isolated: 0,
    online: 0,
    threat: 'SECURE',
    load_kw: 0,
    serial_recent: 0,
    unauthorized_recent: [],
  });
  const [meters, setMeters] = useState<Record<string, MeterInfo>>({});
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [timeRange, setTimeRange] = useState<string>('5 min');
  const [lastAttackResult, setLastAttackResult] = useState<AttackResult | null>(null);
  const [mitmResult, setMitmResult] = useState<MitmSimulationResult | null>(null);

  const [settings, setSettings] = useState<GatewaySettings>({
    auto_isolate: true,
    strict_hmac: false,
    sim_on: true,
    auto_refresh: true,
    refresh_interval: 2,
    live_mitm_on: true,
    live_mitm_mode: 'auto',
    live_mitm_rate: 0.35,
  });
  const [liveMitm, setLiveMitm] = useState<LiveMitmStatus | null>(null);

  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleTimeString());

  // Seconds mapping for telemetry query
  const getSecondsForRange = useCallback((rangeStr: string) => {
    switch (rangeStr) {
      case '1 min':
        return 60;
      case '5 min':
        return 300;
      case '15 min':
        return 900;
      case '1 hour':
        return 3600;
      default:
        return 300;
    }
  }, []);

  // Fetch all live grid state from the backend
  const fetchData = useCallback(async () => {
    try {
      const sinceSec = getSecondsForRange(timeRange);
      const [resStats, resMeters, resTel, resEvt, resSet, resLm] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/meters').then(r => r.json()),
        fetch(`/api/telemetry?since=${sinceSec}`).then(r => r.json()),
        fetch('/api/events?limit=1500').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/live-mitm').then(r => r.json()),
      ]);

      setStats(resStats);
      setMeters(resMeters);
      setTelemetry(resTel);
      setEvents(resEvt);
      setSettings(resSet);
      setLiveMitm(resLm);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to fetch grid data:', err);
    }
  }, [timeRange, getSecondsForRange]);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh timer
  useEffect(() => {
    if (!settings.auto_refresh) return;
    const intervalMs = Math.max(1, settings.refresh_interval) * 1000;
    const timer = setInterval(() => {
      fetchData();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [settings.auto_refresh, settings.refresh_interval, fetchData]);

  // Update backend settings
  const strikeLive = async (attack: string, meter: string | null) => {
    await fetch('/api/live-mitm/strike', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attack, meter }),
    });
    fetchData();
  };
  const cancelStrike = async () => {
    await fetch('/api/live-mitm/strike', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancel: true }),
    });
    fetchData();
  };
  const clearLiveLog = async () => {
    await fetch('/api/live-mitm/clear', { method: 'POST' });
    fetchData();
  };

  const updateSettings = async (patch: Partial<GatewaySettings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  // Run attack simulation
  const handleRunAttack = async (kind: string, target: string): Promise<AttackResult> => {
    const res = await fetch('/api/attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, target }),
    });
    const result: AttackResult = await res.json();
    setLastAttackResult(result);
    await fetchData();
    return result;
  };

  // Run MITM simulation
  const handleRunMitm = async (
    mode: 'attack' | 'defense',
    target: string,
    scenarioKey: MitmScenarioKey = 'current_power'
  ): Promise<MitmSimulationResult> => {
    const res = await fetch('/api/mitm/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, target, scenarioKey }),
    });
    const result: MitmSimulationResult = await res.json();
    setMitmResult(result);
    await fetchData();
    return result;
  };

  // Ingest raw JSON packet
  const handleIngestPacket = async (rawJson: string): Promise<Verdict> => {
    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packet: rawJson }),
    });
    const verdict: Verdict = await res.json();
    await fetchData();
    return verdict;
  };

  // Isolate meter
  const handleIsolateMeter = async (mid: string, reason?: string) => {
    await fetch(`/api/meters/${mid}/isolate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    await fetchData();
  };

  // Restore meter
  const handleRestoreMeter = async (mid: string) => {
    await fetch(`/api/meters/${mid}/restore`, {
      method: 'POST',
    });
    await fetchData();
  };

  // Reset data
  const handleResetData = async () => {
    await fetch('/api/reset', { method: 'POST' });
    setLastAttackResult(null);
    setMitmResult(null);
    await fetchData();
  };

  // Status banner calculation
  const statusInfo = {
    SECURE: { label: 'Normal', color: '#2f7d4f', bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800' },
    ELEVATED: { label: 'Warning', color: '#a16207', bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800' },
    ATTACK: { label: 'Alert', color: '#b42318', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-800' },
  }[stats.threat];

  // Most severe recent event for banner
  const hotEvent = events.find(
    e =>
      Date.now() / 1000 - e.ts < 120 &&
      (e.action === 'flagged' || e.action === 'rejected') &&
      (e.severity === 'critical' || e.severity === 'high')
  );

  return (
    <div className="min-h-screen bg-[#f4f5f7] flex">
      {/* Sidebar matching Streamlit GridGuard styling */}
      <aside className="w-64 bg-white border-r border-[#d8dce2] flex flex-col justify-between shrink-0 p-4">
        <div className="space-y-5">
          {/* Brand header */}
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#1d4ed8]" />
              <span className="text-lg font-bold text-[#1f2933] tracking-tight">GridGuard</span>
            </div>
            <div className="text-xs text-[#66707d] mt-0.5">Smart meter cybersecurity gateway</div>
          </div>

          {/* Navigation */}
          <nav className="space-y-1">
            {PAGES.map(page => {
              const active = activePage === page;
              return (
                <button
                  key={page}
                  onClick={() => setActivePage(page)}
                  className={`w-full text-left px-3 py-2 rounded text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#eef2fb] text-[#1d4ed8] border-l-3 border-[#1d4ed8]'
                      : 'text-[#1f2933] hover:bg-gray-100 border-l-3 border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {page === 'Overview' && <LayoutDashboard className="w-4 h-4" />}
                    {page === 'Alerts' && <ShieldAlert className="w-4 h-4" />}
                    {page === 'Meters' && <Cpu className="w-4 h-4" />}
                    {page === 'Live interception' && <Crosshair className="w-4 h-4" />}
                    {page === 'Attack simulation' && <FlaskConical className="w-4 h-4" />}
                    {page === 'Reports' && <FileSpreadsheet className="w-4 h-4" />}
                    {page}
                  </span>
                  {page === 'Alerts' && stats.threats > 0 && (
                    <span className="bg-[#b42318] text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                      {stats.threats}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Data source toggle */}
          <div className="pt-2 border-t border-[#eceef1]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#66707d] mb-2">
              Data Source
            </div>
            <label className="flex items-center justify-between text-xs text-[#1f2933] cursor-pointer bg-gray-50 p-2 rounded border border-[#d8dce2]/60">
              <span className="font-medium">Use built-in simulator</span>
              <input
                type="checkbox"
                checked={settings.sim_on}
                onChange={e => updateSettings({ sim_on: e.target.checked })}
                className="w-4 h-4 text-[#1d4ed8] rounded cursor-pointer"
              />
            </label>
            <p className="text-[10px] text-[#66707d] mt-1 leading-tight">
              On: generates real-time signed telemetry for both meters.
            </p>
          </div>

          {/* Live MITM attacker */}
          <div className="pt-2 border-t border-[#eceef1]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#66707d] mb-2">
              Live MITM Attacker
            </div>
            <label className="flex items-center justify-between text-xs text-[#1f2933] cursor-pointer bg-gray-50 p-2 rounded border border-[#d8dce2]/60">
              <span className="font-medium">Attack live meters</span>
              <input
                type="checkbox"
                checked={settings.live_mitm_on}
                onChange={e => updateSettings({ live_mitm_on: e.target.checked })}
                className="w-4 h-4 text-[#1d4ed8] rounded cursor-pointer"
              />
            </label>
            <select
              value={settings.live_mitm_mode}
              disabled={!settings.live_mitm_on}
              onChange={e => updateSettings({ live_mitm_mode: e.target.value })}
              className="mt-2 w-full text-xs border border-[#d8dce2] rounded p-1.5 bg-white text-[#1f2933] disabled:opacity-50"
            >
              <option value="auto">Auto (rotate all attacks)</option>
              {(liveMitm?.attacks || []).map(a => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
            <div className="flex items-center justify-between text-xs text-[#1f2933] mt-2">
              <span>Attack rate</span>
              <span className="font-mono">{Math.round(settings.live_mitm_rate * 100)}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="100"
              step="5"
              value={Math.round(settings.live_mitm_rate * 100)}
              disabled={!settings.live_mitm_on}
              onChange={e => updateSettings({ live_mitm_rate: Number(e.target.value) / 100 })}
              className="w-full accent-[#1d4ed8] disabled:opacity-50"
            />
            <p className="text-[10px] text-[#66707d] mt-1 leading-tight">
              Tampers with, replays or forges packets from live Wokwi meters before the gateway verifies them.
              {liveMitm ? ` Intercepted ${liveMitm.intercepted}, attacked ${liveMitm.attacked}.` : ''}
              {liveMitm?.last ? ` Last: ${liveMitm.last.label} on ${liveMitm.last.meter_id}.` : ''}
            </p>
          </div>

          {/* Refresh control */}
          <div className="pt-2 border-t border-[#eceef1]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#66707d] mb-2">
              Refresh Controls
            </div>
            <label className="flex items-center justify-between text-xs text-[#1f2933] cursor-pointer mb-2">
              <span>Auto-refresh</span>
              <input
                type="checkbox"
                checked={settings.auto_refresh}
                onChange={e => updateSettings({ auto_refresh: e.target.checked })}
                className="w-4 h-4 text-[#1d4ed8] rounded cursor-pointer"
              />
            </label>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-[#66707d]">
                <span>Interval</span>
                <span className="font-mono">{settings.refresh_interval}s</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={settings.refresh_interval}
                disabled={!settings.auto_refresh}
                onChange={e => updateSettings({ refresh_interval: Number(e.target.value) })}
                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#1d4ed8] disabled:opacity-40"
              />
            </div>
          </div>

          {/* Gateway Settings */}
          <div className="pt-2 border-t border-[#eceef1] space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#66707d] mb-1">
              Gateway Controls
            </div>
            <label className="flex items-center justify-between text-xs text-[#1f2933] cursor-pointer">
              <span>Auto-isolate faulty meters</span>
              <input
                type="checkbox"
                checked={settings.auto_isolate}
                onChange={e => updateSettings({ auto_isolate: e.target.checked })}
                className="w-4 h-4 text-[#1d4ed8] rounded cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between text-xs text-[#1f2933] cursor-pointer">
              <span>Require signed packets</span>
              <input
                type="checkbox"
                checked={settings.strict_hmac}
                onChange={e => updateSettings({ strict_hmac: e.target.checked })}
                className="w-4 h-4 text-[#1d4ed8] rounded cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Sidebar Footer Info */}
        <div className="pt-4 border-t border-[#d8dce2] text-[11px] text-[#66707d] space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${settings.sim_on ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
            <span>Simulator: {settings.sim_on ? 'Active' : 'Paused'}</span>
          </div>
          <div>Database: in-memory engine</div>
          <div className="text-[10px] opacity-75">NISTIR 7628 Smart Grid Standard</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl overflow-y-auto">
        {/* Top Header */}
        <div className="flex flex-wrap justify-between items-baseline gap-2 mb-4">
          <h1 className="text-xl font-bold text-[#1f2933]">{activePage}</h1>
          <div className="text-xs text-[#66707d] flex items-center gap-3">
            <span>Updated {lastUpdated}</span>
            <span>·</span>
            <span>
              System status:{' '}
              <strong style={{ color: statusInfo.color }} className="font-bold">
                {statusInfo.label}
              </strong>
            </span>
            <button
              onClick={fetchData}
              title="Manual Refresh"
              className="p-1 rounded hover:bg-gray-200 text-[#1f2933] cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Active Alert Banner */}
        {stats.threat !== 'SECURE' && hotEvent && (
          <div
            className={`border-l-4 p-3 rounded text-xs mb-4 flex items-center justify-between shadow-2xs ${statusInfo.bg} ${statusInfo.border} ${statusInfo.text}`}
          >
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 shrink-0 text-[#b42318]" />
              <span>
                <strong>Active Alert:</strong> {hotEvent.meter_id || 'unknown'} —{' '}
                <span className="capitalize">{hotEvent.type.replace(/_/g, ' ')}</span>: {hotEvent.reason}
              </span>
            </div>
            <button
              onClick={() => setActivePage('Alerts')}
              className="text-xs font-semibold underline hover:opacity-80 shrink-0"
            >
              View incident →
            </button>
          </div>
        )}

        {/* Rogue Device Warning Banner */}
        {stats.unauthorized_recent.length > 0 && (
          <div className="bg-red-50 border border-red-300 text-red-800 p-2.5 rounded text-xs mb-4 flex items-center justify-between">
            <span>
              <strong>Unauthorized source detected:</strong> {stats.unauthorized_recent.join(', ')}. Packets were rejected by the allow-list filter.
            </span>
            <button
              onClick={() => setActivePage('Alerts')}
              className="text-xs font-semibold underline hover:text-red-950"
            >
              Inspect
            </button>
          </div>
        )}

        {/* Active Tab Page View */}
        {activePage === 'Overview' && (
          <OverviewPage
            stats={stats}
            meters={meters}
            telemetry={telemetry}
            events={events}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            onNavigateTab={tab => setActivePage(tab as PageType)}
          />
        )}

        {activePage === 'Alerts' && <AlertsPage events={events} />}

        {activePage === 'Meters' && (
          <MetersPage
            meters={meters}
            events={events}
            onIsolate={handleIsolateMeter}
            onRestore={handleRestoreMeter}
          />
        )}

        {activePage === 'Live interception' && (
          <LiveInterceptionPage
            status={liveMitm}
            meters={meters}
            onStrike={strikeLive}
            onCancel={cancelStrike}
            onClear={clearLiveLog}
          />
        )}

        {activePage === 'Attack simulation' && (
          <AttackSimulationPage
            meters={meters}
            onRunMitm={handleRunMitm}
            onIngestPacket={handleIngestPacket}
            mitmResult={mitmResult}
          />
        )}

        {activePage === 'Reports' && (
          <ReportsPage
            stats={stats}
            meters={meters}
            events={events}
            onResetData={handleResetData}
          />
        )}
      </main>
    </div>
  );
}
