import React from 'react';
import { GridStats, MeterInfo, TelemetryPoint, SecurityEvent } from '../types.js';
import { LiveMetricChart } from './LiveMetricChart.js';
import { ShieldCheck, ShieldAlert, AlertTriangle, Activity, Zap, Cpu, Lock, CheckCircle2 } from 'lucide-react';

interface OverviewPageProps {
  stats: GridStats;
  meters: Record<string, MeterInfo>;
  telemetry: TelemetryPoint[];
  events: SecurityEvent[];
  timeRange: string;
  setTimeRange: (val: string) => void;
  onNavigateTab: (tab: string) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  stats,
  meters,
  telemetry,
  events,
  timeRange,
  setTimeRange,
  onNavigateTab,
}) => {
  const getStatusBadge = (meter: MeterInfo) => {
    switch (meter.status) {
      case 'isolated':
        return <span className="bg-[#5b6472]/15 text-[#5b6472] px-2 py-0.5 rounded text-xs font-semibold">Isolated</span>;
      case 'alert':
        return <span className="bg-[#b42318]/15 text-[#b42318] px-2 py-0.5 rounded text-xs font-semibold">Alert</span>;
      case 'warning':
        return <span className="bg-[#a16207]/15 text-[#a16207] px-2 py-0.5 rounded text-xs font-semibold">Warning</span>;
      case 'no_signal':
        return <span className="bg-[#66707d]/15 text-[#66707d] px-2 py-0.5 rounded text-xs font-semibold">No signal</span>;
      default:
        return <span className="bg-[#2f7d4f]/15 text-[#2f7d4f] px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#2f7d4f] animate-pulse"></span> Online</span>;
    }
  };

  const timeAgo = (ts: number | null) => {
    if (!ts) return 'never';
    const sec = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const getMetricClass = (type: 'v' | 'i' | 'p' | 't', val: number) => {
    if (type === 'v') {
      if (val < 200 || val > 255) return 'text-[#b42318] font-bold';
      if (val < 216 || val > 244) return 'text-[#a16207] font-semibold';
    } else if (type === 'i') {
      if (val > 8.0) return 'text-[#b42318] font-bold';
      if (val > 3.5) return 'text-[#a16207] font-semibold';
    } else if (type === 'p') {
      if (val > 1.8) return 'text-[#b42318] font-bold';
      if (val > 0.8) return 'text-[#a16207] font-semibold';
    } else if (type === 't') {
      if (val > 42) return 'text-[#b42318] font-bold';
      if (val > 33) return 'text-[#a16207] font-semibold';
    }
    return 'text-[#1f2933]';
  };

  const sevColors: Record<string, string> = {
    critical: 'text-[#b42318] bg-[#b42318]/10 border-[#b42318]/20',
    high: 'text-[#c2410c] bg-[#c2410c]/10 border-[#c2410c]/20',
    medium: 'text-[#a16207] bg-[#a16207]/10 border-[#a16207]/20',
    low: 'text-[#1d4ed8] bg-[#1d4ed8]/10 border-[#1d4ed8]/20',
    info: 'text-[#66707d] bg-[#66707d]/10 border-[#66707d]/20',
  };

  return (
    <div className="space-y-6">
      {/* 5-Card Top Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">Meters online</div>
          <div className="text-2xl font-bold text-[#1f2933] mt-1 tracking-tight">
            {stats.online} <span className="text-xs font-normal text-[#66707d]">of {Object.keys(meters).length}</span>
          </div>
          <div className="text-xs text-[#66707d] mt-1">{stats.isolated} isolated</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">Grid load</div>
          <div className="text-2xl font-bold text-[#1f2933] mt-1 tracking-tight">
            {stats.load_kw.toFixed(2)} <span className="text-xs font-normal text-[#66707d]">kW</span>
          </div>
          <div className="text-xs text-[#66707d] mt-1">online meters combined</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">Packets accepted</div>
          <div className="text-2xl font-bold text-[#1f2933] mt-1 tracking-tight">
            {stats.accepted.toLocaleString()}
          </div>
          <div className="text-xs text-[#66707d] mt-1">signature & seq checked</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">Alerts logged</div>
          <div className="text-2xl font-bold text-[#1f2933] mt-1 tracking-tight">
            {stats.threats.toLocaleString()}
          </div>
          <div className="text-xs text-[#66707d] mt-1">{stats.rejected.toLocaleString()} rejected</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs col-span-2 md:col-span-1">
          <div className="text-xs text-[#66707d]">Packets blocked</div>
          <div className="text-2xl font-bold text-[#1f2933] mt-1 tracking-tight">
            {stats.blocked.toLocaleString()}
          </div>
          <div className="text-xs text-[#66707d] mt-1">from isolated meters</div>
        </div>
      </div>

      {/* Meter Cards */}
      <div>
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-3 flex items-center justify-between">
          <span>Substation Smart Meters</span>
          <span className="text-xs font-normal text-[#66707d]">Cryptographic HMAC-SHA256 verified</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(meters).map(([mid, m]) => {
            const isIsolated = m.status === 'isolated';
            return (
              <div
                key={mid}
                className={`border rounded-md p-4 transition-all shadow-2xs ${
                  isIsolated
                    ? 'bg-[#f0f1f3] border-[#b9c0ca]'
                    : 'bg-white border-[#d8dce2] hover:border-[#1d4ed8]/40'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="text-base font-bold text-[#1f2933] flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${mid === 'MTR-001' ? 'bg-[#1d4ed8]' : 'bg-[#c2410c]'}`}></span>
                      {m.name}
                    </div>
                    <div className="text-xs text-[#66707d] mt-0.5">
                      {m.meter_id} · {m.site}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {getStatusBadge(m)}
                    {m.data_source !== 'simulator' ? (
                      <span className="bg-[#1d4ed8]/10 text-[#1d4ed8] px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide">
                        {m.data_source === 'arduino' ? 'Arduino live' : 'Wokwi live'}
                      </span>
                    ) : (
                      <span className="bg-[#66707d]/10 text-[#66707d] px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide">
                        Simulated
                      </span>
                    )}
                  </div>
                </div>

                {/* 4 Readings Grid */}
                <div className="grid grid-cols-4 gap-2 my-3.5 pt-3 border-t border-[#eceef1]">
                  <div>
                    <div className="text-[11px] text-[#66707d]">Voltage</div>
                    <div className={`text-lg font-semibold mt-0.5 ${m.latest ? getMetricClass('v', m.latest.voltage_v) : 'text-[#66707d]'}`}>
                      {m.latest ? m.latest.voltage_v.toFixed(1) : '–'}
                      <span className="text-[11px] font-normal text-[#66707d] ml-0.5">V</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#66707d]">Current</div>
                    <div className={`text-lg font-semibold mt-0.5 ${m.latest ? getMetricClass('i', m.latest.current_a) : 'text-[#66707d]'}`}>
                      {m.latest ? m.latest.current_a.toFixed(2) : '–'}
                      <span className="text-[11px] font-normal text-[#66707d] ml-0.5">A</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#66707d]">Power</div>
                    <div className={`text-lg font-semibold mt-0.5 ${m.latest ? getMetricClass('p', m.latest.power_kw) : 'text-[#66707d]'}`}>
                      {m.latest ? m.latest.power_kw.toFixed(2) : '–'}
                      <span className="text-[11px] font-normal text-[#66707d] ml-0.5">kW</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#66707d]">Temperature</div>
                    <div className={`text-lg font-semibold mt-0.5 ${m.latest ? getMetricClass('t', m.latest.temp_c) : 'text-[#66707d]'}`}>
                      {m.latest ? m.latest.temp_c.toFixed(1) : '–'}
                      <span className="text-[11px] font-normal text-[#66707d] ml-0.5">°C</span>
                    </div>
                  </div>
                </div>

                {/* Footer specs */}
                <div className="text-xs text-[#66707d] flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-[#eceef1]/60">
                  <span>Last seen: <b className="text-[#1f2933]">{timeAgo(m.last_seen)}</b></span>
                  <span>Energy: <b className="text-[#1f2933]">{m.energy_wh.toFixed(2)} Wh</b></span>
                  <span>Seq: <b className="text-[#1f2933]">{m.last_seq}</b></span>
                  <span>Health: <b className={`${m.score < 70 ? 'text-[#b42318]' : m.score < 90 ? 'text-[#a16207]' : 'text-[#2f7d4f]'}`}>{m.score}/100</b></span>
                </div>

                {isIsolated && (
                  <div className="mt-2.5 bg-red-50 border border-red-200 text-red-800 text-xs p-2 rounded">
                    <strong>Isolated:</strong> {m.isolated_reason || 'by operator'}. Packets dropped.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Readings Charts Section */}
      <div>
        <div className="flex flex-wrap justify-between items-center border-b border-[#d8dce2] pb-2 mb-3">
          <div className="text-sm font-bold text-[#1f2933]">Live Grid Telemetry</div>
          <div className="flex items-center gap-1 bg-white border border-[#d8dce2] rounded p-0.5 text-xs">
            {['1 min', '5 min', '15 min', '1 hour'].map(rng => (
              <button
                key={rng}
                onClick={() => setTimeRange(rng)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  timeRange === rng
                    ? 'bg-[#1d4ed8] text-white font-medium'
                    : 'text-[#66707d] hover:bg-gray-100'
                }`}
              >
                {rng}
              </button>
            ))}
          </div>
        </div>

        {telemetry.length === 0 ? (
          <div className="text-center py-10 bg-white border border-dashed border-[#d8dce2] rounded text-sm text-[#66707d]">
            No telemetry received yet. Ensure built-in simulator is enabled or send packets via Attack Simulation.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LiveMetricChart
                data={telemetry}
                metricKey="power_kw"
                title="Active Power"
                unit="kW"
                minSpan={0.5}
                lines={[
                  { y: 0.8, color: '#a16207', label: 'Warn (0.8 kW)' },
                  { y: 1.8, color: '#b42318', label: 'Crit (1.8 kW)' },
                ]}
                floor0
              />
              <LiveMetricChart
                data={telemetry}
                metricKey="current_a"
                title="Line Current"
                unit="A"
                minSpan={1.5}
                lines={[
                  { y: 3.5, color: '#a16207', label: 'Warn (3.5 A)' },
                  { y: 8.0, color: '#b42318', label: 'Crit (8.0 A)' },
                ]}
                floor0
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LiveMetricChart
                data={telemetry}
                metricKey="voltage_v"
                title="RMS Voltage"
                unit="V"
                minSpan={12}
                lines={[
                  { y: 216.0, color: '#a16207', label: 'Warn low (216V)' },
                  { y: 244.0, color: '#a16207', label: 'Warn high (244V)' },
                  { y: 200.0, color: '#b42318', label: 'Crit low (200V)' },
                  { y: 255.0, color: '#b42318', label: 'Crit high (255V)' },
                ]}
              />
              <LiveMetricChart
                data={telemetry}
                metricKey="temp_c"
                title="Meter Temperature"
                unit="°C"
                minSpan={6}
                lines={[
                  { y: 33.0, color: '#a16207', label: 'Warn (33°C)' },
                  { y: 42.0, color: '#b42318', label: 'Crit (42°C)' },
                ]}
              />
            </div>

            <LiveMetricChart
              data={telemetry}
              metricKey="energy_wh"
              title="Metered Cumulative Energy"
              unit="Wh"
              minSpan={2}
              lines={[]}
              floor0
            />

            <p className="text-xs text-[#66707d] italic">
              Dashed lines show warning (amber) and critical (red) thresholds. A red ‘x’ marker indicates an anomaly flagged by the gateway rules.
            </p>
          </div>
        )}
      </div>

      {/* Recent Events Preview */}
      <div>
        <div className="flex justify-between items-center border-b border-[#d8dce2] pb-1.5 mb-3">
          <div className="text-sm font-bold text-[#1f2933]">Recent Gateway Events</div>
          <button
            onClick={() => onNavigateTab('Alerts')}
            className="text-xs text-[#1d4ed8] hover:underline font-medium"
          >
            View all alerts →
          </button>
        </div>

        {events.length === 0 ? (
          <div className="text-center py-6 bg-white border border-dashed border-[#d8dce2] rounded text-sm text-[#66707d]">
            No events recorded yet.
          </div>
        ) : (
          <div className="bg-white border border-[#d8dce2] rounded-md overflow-x-auto shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#fafbfc] border-b border-[#d8dce2] text-[#66707d]">
                  <th className="py-2 px-3 font-semibold">Time</th>
                  <th className="py-2 px-3 font-semibold">Meter</th>
                  <th className="py-2 px-3 font-semibold">Severity</th>
                  <th className="py-2 px-3 font-semibold">Event</th>
                  <th className="py-2 px-3 font-semibold">Detail</th>
                  <th className="py-2 px-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eceef1]">
                {events.slice(0, 6).map(e => (
                  <tr key={e.id} className="hover:bg-gray-50/60">
                    <td className="py-2 px-3 font-mono text-[#66707d]">{e.timeStr}</td>
                    <td className="py-2 px-3 font-mono font-medium text-[#1f2933]">{e.meter_id || 'unknown'}</td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${sevColors[e.severity] || ''}`}>
                        {e.severity}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium text-[#1f2933]">{e.type.replace(/_/g, ' ')}</td>
                    <td className="py-2 px-3 text-[#66707d] max-w-xs truncate">{e.reason}</td>
                    <td className="py-2 px-3 capitalize font-medium text-[#1f2933]">{e.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
