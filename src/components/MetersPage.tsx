import React, { useState } from 'react';
import { MeterInfo, SecurityEvent } from '../types.js';
import { ShieldAlert, ShieldCheck, RefreshCw, Cpu, Server, CheckCircle2, AlertOctagon, HelpCircle } from 'lucide-react';

interface MetersPageProps {
  meters: Record<string, MeterInfo>;
  events: SecurityEvent[];
  onIsolate: (id: string, reason?: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}

export const MetersPage: React.FC<MetersPageProps> = ({
  meters,
  events,
  onIsolate,
  onRestore,
}) => {
  const [isolatingId, setIsolatingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const rogueEvents = events.filter(e => e.type === 'unauthorized_device');
  const rogueMap: Record<string, { attempts: number; first_seen: string; last_seen: string; source: string }> = {};

  for (const e of rogueEvents) {
    const mid = e.meter_id || 'unknown';
    if (!rogueMap[mid]) {
      rogueMap[mid] = {
        attempts: 1,
        first_seen: e.timeStr,
        last_seen: e.timeStr,
        source: e.addr,
      };
    } else {
      rogueMap[mid].attempts += 1;
      rogueMap[mid].first_seen = e.timeStr; // older because events are unshifted
    }
  }

  const handleIsolateClick = async (mid: string) => {
    setIsolatingId(mid);
    try {
      await onIsolate(mid, 'Operator manually isolated this meter from inventory');
    } finally {
      setIsolatingId(null);
    }
  };

  const handleRestoreClick = async (mid: string) => {
    setRestoringId(mid);
    try {
      await onRestore(mid);
    } finally {
      setRestoringId(null);
    }
  };

  const rules = [
    { rule: 'Device allow-list', condition: 'Only registered meter IDs (MTR-001, MTR-002) may send telemetry', sev: 'Critical', action: 'Reject' },
    { rule: 'Message signature', condition: 'HMAC-SHA256 over exact canonical tokens, one unique key per device', sev: 'Critical', action: 'Reject' },
    { rule: 'Replay protection', condition: 'Sequence number must strictly increase; timestamp skew within 30 seconds', sev: 'High', action: 'Reject' },
    { rule: 'Rate limit', condition: 'More than 8 packets in 5 seconds from one device (possible DoS flood)', sev: 'High', action: 'Reject / Drop' },
    { rule: 'Sensor plausibility', condition: 'Voltage 0–1000 V, current 0–100 A, temperature −40 to 150 °C', sev: 'Critical', action: 'Reject' },
    { rule: 'Voltage tolerance', condition: 'Warn outside 216–244 V, critical outside 200–255 V', sev: 'Medium / Critical', action: 'Flag' },
    { rule: 'Current tolerance', condition: 'Warn above 3.5 A, critical above 8.0 A', sev: 'Medium / Critical', action: 'Flag' },
    { rule: 'Temperature tolerance', condition: 'Warn above 33 °C, critical above 42 °C', sev: 'Medium / Critical', action: 'Flag' },
    { rule: 'Power threshold', condition: 'Warn above 0.8 kW, critical above 1.8 kW', sev: 'Medium / Critical', action: 'Flag' },
    { rule: 'Power consistency', condition: 'Reported kW cannot exceed physical V × I apparent power by >5%', sev: 'High', action: 'Flag' },
    { rule: 'Energy rollback', condition: 'Cumulative energy register (Wh) may not decrease by >0.005 Wh', sev: 'High', action: 'Flag' },
    { rule: 'Sudden spike', condition: 'Power reading jumps above 2.5× recent 10-packet rolling mean', sev: 'Medium', action: 'Flag' },
    { rule: 'Meter self-alert', condition: 'Meter firmware asserts hardware tamper or alert boolean flag', sev: 'Medium', action: 'Flag' },
    { rule: 'Auto-isolation', condition: '3 high or critical severity packets within 60-second sliding window', sev: 'High', action: 'Auto-Isolate Meter' },
  ];

  return (
    <div className="space-y-6">
      {/* Asset Inventory Cards */}
      <div>
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-3 flex justify-between items-center">
          <span>Substation Device Inventory & Access Control</span>
          <span className="text-xs font-normal text-[#66707d]">Hardware isolation active</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(meters).map(([mid, m]) => {
            const isIsolated = m.status === 'isolated';
            return (
              <div
                key={mid}
                className={`border rounded-md p-4 transition-all shadow-2xs ${
                  isIsolated ? 'bg-[#f0f1f3] border-[#b9c0ca]' : 'bg-white border-[#d8dce2]'
                }`}
              >
                <div className="flex justify-between items-start gap-2 border-b border-[#eceef1] pb-3 mb-3">
                  <div>
                    <h3 className="text-base font-bold text-[#1f2933] flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${mid === 'MTR-001' ? 'bg-[#1d4ed8]' : 'bg-[#c2410c]'}`} />
                      {m.name}
                    </h3>
                    <p className="text-xs text-[#66707d] mt-0.5">{m.site}</p>
                  </div>
                  <div>
                    {isIsolated ? (
                      <span className="bg-[#5b6472]/15 text-[#5b6472] px-2 py-0.5 rounded text-xs font-semibold">
                        Isolated
                      </span>
                    ) : (
                      <span className="bg-[#2f7d4f]/15 text-[#2f7d4f] px-2 py-0.5 rounded text-xs font-semibold">
                        Online
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Device ID</span>
                    <span className="font-mono font-bold text-[#1f2933]">{mid}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Location / Site</span>
                    <span className="text-[#1f2933]">{m.site}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Firmware Version</span>
                    <span className="font-mono text-[#1f2933]">{m.firmware}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Authentication</span>
                    <span className="font-semibold text-[#1d4ed8]">HMAC-SHA256 (Per-meter pre-shared key)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Packets Accepted</span>
                    <span className="font-mono font-medium text-emerald-700">{m.accepted.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Packets Rejected</span>
                    <span className="font-mono font-medium text-red-600">{m.rejected.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Packets Blocked</span>
                    <span className="font-mono font-medium text-slate-600">{m.blocked.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#eceef1]">
                    <span className="text-[#66707d]">Meter Cumulative Energy</span>
                    <span className="font-mono font-bold text-[#1f2933]">{m.energy_wh.toFixed(2)} Wh</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#eceef1] flex items-center justify-between">
                  <span className="text-xs text-[#66707d]">
                    Health score: <strong className={m.score < 80 ? 'text-amber-700' : 'text-emerald-700'}>{m.score}/100</strong>
                  </span>

                  {isIsolated ? (
                    <button
                      onClick={() => handleRestoreClick(mid)}
                      disabled={restoringId === mid}
                      className="text-xs font-semibold px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer"
                    >
                      {restoringId === mid ? 'Restoring...' : 'Restore to Service'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleIsolateClick(mid)}
                      disabled={isolatingId === mid}
                      className="text-xs font-semibold px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 transition-colors shadow-2xs cursor-pointer"
                    >
                      {isolatingId === mid ? 'Isolating...' : 'Isolate This Meter'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unregistered Devices Seen */}
      <div>
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-3 flex justify-between items-center">
          <span>Unregistered Rogue Devices Intercepted</span>
          <span className="text-xs font-normal text-[#66707d]">Hardware allow-list defense</span>
        </div>

        {Object.keys(rogueMap).length === 0 ? (
          <div className="text-center py-6 bg-white border border-dashed border-[#d8dce2] rounded text-sm text-[#66707d]">
            No unregistered devices have attempted connection. Allow-list is clear.
          </div>
        ) : (
          <div className="bg-white border border-[#d8dce2] rounded-md overflow-x-auto shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#fafbfc] border-b border-[#d8dce2] text-[#66707d]">
                  <th className="py-2 px-3 font-semibold">Rogue Device ID</th>
                  <th className="py-2 px-3 font-semibold">Attempts</th>
                  <th className="py-2 px-3 font-semibold">First Seen</th>
                  <th className="py-2 px-3 font-semibold">Last Seen</th>
                  <th className="py-2 px-3 font-semibold">Source Address</th>
                  <th className="py-2 px-3 font-semibold">Gateway Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eceef1]">
                {Object.entries(rogueMap).map(([mid, info]) => (
                  <tr key={mid} className="hover:bg-gray-50">
                    <td className="py-2 px-3 font-mono font-bold text-red-600">{mid}</td>
                    <td className="py-2 px-3 font-mono font-medium">{info.attempts}</td>
                    <td className="py-2 px-3 font-mono text-[#66707d]">{info.first_seen}</td>
                    <td className="py-2 px-3 font-mono text-[#66707d]">{info.last_seen}</td>
                    <td className="py-2 px-3 font-mono text-[#66707d]">{info.source}</td>
                    <td className="py-2 px-3 font-semibold text-[#b42318]">REJECTED (Critical)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Gateway Security Rules Reference */}
      <div>
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-3 flex justify-between items-center">
          <span>Active Gateway Security Controls & Rules</span>
          <span className="text-xs font-normal text-[#66707d]">NISTIR 7628 Smart Grid Standard</span>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md overflow-x-auto shadow-2xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#fafbfc] border-b border-[#d8dce2] text-[#66707d]">
                <th className="py-2.5 px-3 font-semibold">Security Control</th>
                <th className="py-2.5 px-3 font-semibold">Rule Condition</th>
                <th className="py-2.5 px-3 font-semibold">Severity</th>
                <th className="py-2.5 px-3 font-semibold">Gateway Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eceef1]">
              {rules.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50/60">
                  <td className="py-2 px-3 font-semibold text-[#1f2933]">{r.rule}</td>
                  <td className="py-2 px-3 text-[#66707d]">{r.condition}</td>
                  <td className="py-2 px-3 font-medium">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        r.sev.includes('Critical')
                          ? 'bg-red-100 text-red-700'
                          : r.sev.includes('High')
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {r.sev}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-mono font-medium text-[#1f2933]">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
