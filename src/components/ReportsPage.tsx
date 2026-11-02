import React, { useState } from 'react';
import { GridStats, MeterInfo, SecurityEvent } from '../types.js';
import { Download, FileText, Trash2, Printer, AlertTriangle, ShieldCheck } from 'lucide-react';

interface ReportsPageProps {
  stats: GridStats;
  meters: Record<string, MeterInfo>;
  events: SecurityEvent[];
  onResetData: () => Promise<void>;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  stats,
  meters,
  events,
  onResetData,
}) => {
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);

  const handleReset = async () => {
    if (!confirmReset) return;
    setIsResetting(true);
    try {
      await onResetData();
      setConfirmReset(false);
    } finally {
      setIsResetting(false);
    }
  };

  const threatLabel = {
    SECURE: 'Normal (Secure)',
    ELEVATED: 'Warning (Elevated Risk)',
    ATTACK: 'Critical (Active Threat)',
  }[stats.threat];

  return (
    <div className="space-y-6">
      {/* Posture Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">System Status</div>
          <div className="text-lg font-bold text-[#1f2933] mt-1">{threatLabel}</div>
          <div className="text-xs text-[#66707d] mt-0.5">last 2 minutes window</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">Packets Accepted</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{stats.accepted.toLocaleString()}</div>
          <div className="text-xs text-[#66707d] mt-0.5">verified genuine</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">Packets Rejected</div>
          <div className="text-2xl font-bold text-red-700 mt-1">{stats.rejected.toLocaleString()}</div>
          <div className="text-xs text-[#66707d] mt-0.5">failed security rules</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs">
          <div className="text-xs text-[#66707d]">Alerts Logged</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{stats.threats.toLocaleString()}</div>
          <div className="text-xs text-[#66707d] mt-0.5">flagged or rejected</div>
        </div>

        <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs col-span-2 md:col-span-1">
          <div className="text-xs text-[#66707d]">Meters Isolated</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{stats.isolated}</div>
          <div className="text-xs text-[#66707d] mt-0.5">currently quarantined</div>
        </div>
      </div>

      {/* Export Section */}
      <div>
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-3">
          Export Incident & Telemetry Data
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm text-[#1f2933] flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#1d4ed8]" /> Security Events Log
              </div>
              <p className="text-xs text-[#66707d] mt-1.5">
                Download complete audit log of all security alerts, HMAC failures, replay attempts, and isolation events.
              </p>
            </div>
            <div className="mt-4">
              <a
                href="/api/export/events.csv"
                download="gridguard_events.csv"
                className="w-full py-2 px-3 rounded text-xs font-semibold bg-[#1d4ed8] text-white hover:bg-blue-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Download Events (CSV)
              </a>
            </div>
          </div>

          <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm text-[#1f2933] flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#1d4ed8]" /> Meter Telemetry Data
              </div>
              <p className="text-xs text-[#66707d] mt-1.5">
                Download full recorded series of voltage, current, active power, temperature, and cumulative energy Wh.
              </p>
            </div>
            <div className="mt-4">
              <a
                href="/api/export/telemetry.csv"
                download="gridguard_telemetry.csv"
                className="w-full py-2 px-3 rounded text-xs font-semibold bg-[#1d4ed8] text-white hover:bg-blue-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Download Telemetry (CSV)
              </a>
            </div>
          </div>

          <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm text-[#1f2933] flex items-center gap-2">
                <Printer className="w-4 h-4 text-[#1d4ed8]" /> Official Incident Report
              </div>
              <p className="text-xs text-[#66707d] mt-1.5">
                Generate an executive printable incident summary with asset health, security posture, and incident chronology.
              </p>
            </div>
            <div className="mt-4">
              <button
                onClick={() => setShowPrintModal(true)}
                className="w-full py-2 px-3 rounded text-xs font-semibold bg-gray-800 text-white hover:bg-gray-900 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Open Printable Report
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Section */}
      <div>
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-3">
          Lab Database Maintenance
        </div>

        <div className="bg-white border border-red-200 rounded-md p-4 shadow-2xs space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-[#1f2933]">Reset All In-Memory Telemetry & Logs</h4>
              <p className="text-xs text-[#66707d] mt-1">
                Clears all event history, packet counters, and telemetry data. Restores meters to online state with zeroed sequences.
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-red-100">
            <label className="flex items-center gap-2 text-xs text-[#1f2933] cursor-pointer">
              <input
                type="checkbox"
                checked={confirmReset}
                onChange={e => setConfirmReset(e.target.checked)}
                className="rounded border-[#d8dce2] text-red-600 focus:ring-red-500 cursor-pointer"
              />
              <span>I confirm deletion of all simulated telemetry and incident logs</span>
            </label>

            <button
              onClick={handleReset}
              disabled={!confirmReset || isResetting}
              className="px-4 py-2 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isResetting ? 'Resetting...' : 'Reset Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Printable Report Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[#d8dce2] flex justify-between items-center bg-gray-50">
              <div className="font-bold text-sm text-[#1f2933]">GridGuard Incident Report — Preview</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded text-xs font-semibold bg-[#1d4ed8] text-white hover:bg-blue-800 flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
                </button>
                <button
                  onClick={() => setShowPrintModal(false)}
                  className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-8 overflow-y-auto space-y-6 text-[#1f2933]">
              <div className="border-b-2 border-gray-900 pb-4">
                <h1 className="text-2xl font-bold tracking-tight">GridGuard — Smart Grid Incident Report</h1>
                <p className="text-xs text-[#66707d] mt-1">
                  Generated {new Date().toLocaleString()} · Substation Telemetry & Cyber Defense Gateway
                </p>
              </div>

              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-900 mb-2">Executive Summary</h2>
                <div className="grid grid-cols-2 gap-2 text-xs border border-[#d8dce2] rounded p-3 bg-gray-50">
                  <div><strong>Current Posture:</strong> {threatLabel}</div>
                  <div><strong>Packets Verified & Accepted:</strong> {stats.accepted.toLocaleString()}</div>
                  <div><strong>Packets Rejected:</strong> {stats.rejected.toLocaleString()}</div>
                  <div><strong>Packets Blocked from Isolated Meters:</strong> {stats.blocked.toLocaleString()}</div>
                  <div><strong>Security Incidents Logged:</strong> {stats.threats.toLocaleString()}</div>
                  <div><strong>Meters Isolated:</strong> {stats.isolated}</div>
                </div>
              </div>

              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-900 mb-2">Asset Inventory Status</h2>
                <table className="w-full text-xs border border-[#d8dce2] text-left">
                  <thead className="bg-[#1f2933] text-white">
                    <tr>
                      <th className="p-2">Meter</th>
                      <th className="p-2">Site</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Accepted</th>
                      <th className="p-2">Rejected</th>
                      <th className="p-2">Blocked</th>
                      <th className="p-2">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eceef1]">
                    {Object.entries(meters).map(([mid, m]) => (
                      <tr key={mid}>
                        <td className="p-2 font-semibold">{m.name} ({mid})</td>
                        <td className="p-2 text-[#66707d]">{m.site}</td>
                        <td className="p-2 uppercase font-bold text-xs">{m.status}</td>
                        <td className="p-2">{m.accepted}</td>
                        <td className="p-2">{m.rejected}</td>
                        <td className="p-2">{m.blocked}</td>
                        <td className="p-2 font-bold">{m.score}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-900 mb-2">Most Recent Security Incidents</h2>
                {events.length === 0 ? (
                  <p className="text-xs text-[#66707d]">No security events logged.</p>
                ) : (
                  <table className="w-full text-xs border border-[#d8dce2] text-left">
                    <thead className="bg-[#1f2933] text-white">
                      <tr>
                        <th className="p-2">Time</th>
                        <th className="p-2">Meter</th>
                        <th className="p-2">Severity</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">Reason</th>
                        <th className="p-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eceef1]">
                      {events.slice(0, 20).map(e => (
                        <tr key={e.id}>
                          <td className="p-2 font-mono">{e.timeStr}</td>
                          <td className="p-2 font-mono">{e.meter_id || 'unknown'}</td>
                          <td className="p-2 font-bold uppercase">{e.severity}</td>
                          <td className="p-2">{e.type.replace(/_/g, ' ')}</td>
                          <td className="p-2 text-[#66707d] max-w-xs">{e.reason}</td>
                          <td className="p-2 capitalize">{e.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="pt-4 border-t border-[#d8dce2] text-[11px] text-[#66707d]">
                Controls in force: Device allow-list · HMAC-SHA256 message authentication · sequence + timestamp replay protection · rate limiting · plausibility and threshold anomaly rules · automatic meter isolation.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
