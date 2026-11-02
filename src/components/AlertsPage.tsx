import React, { useState, useMemo } from 'react';
import { SecurityEvent, Severity } from '../types.js';
import { Filter, Search, ChevronRight, Copy, Check, Terminal } from 'lucide-react';

interface AlertsPageProps {
  events: SecurityEvent[];
}

export const AlertsPage: React.FC<AlertsPageProps> = ({ events }) => {
  const [selectedSeverities, setSelectedSeverities] = useState<Severity[]>([
    'critical',
    'high',
    'medium',
    'low',
    'info',
  ]);
  const [selectedMeter, setSelectedMeter] = useState<string>('all');
  const [selectedAction, setSelectedAction] = useState<string>('all');
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Available unique meters and actions
  const metersList = useMemo(() => {
    const set = new Set<string>();
    events.forEach(e => set.add(e.meter_id || 'unknown'));
    return Array.from(set).sort();
  }, [events]);

  const actionsList = useMemo(() => {
    const set = new Set<string>();
    events.forEach(e => set.add(e.action));
    return Array.from(set).sort();
  }, [events]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (!selectedSeverities.includes(e.severity)) return false;
      if (selectedMeter !== 'all' && (e.meter_id || 'unknown') !== selectedMeter) return false;
      if (selectedAction !== 'all' && e.action !== selectedAction) return false;
      return true;
    });
  }, [events, selectedSeverities, selectedMeter, selectedAction]);

  // Active selected event for detail drawer
  const activeEvent = useMemo(() => {
    if (selectedEventId) {
      const found = events.find(e => e.id === selectedEventId);
      if (found) return found;
    }
    return filteredEvents[0] || null;
  }, [selectedEventId, events, filteredEvents]);

  // Event counts for stats
  const critCount = filteredEvents.filter(e => e.severity === 'critical').length;
  const highCount = filteredEvents.filter(e => e.severity === 'high').length;
  const medCount = filteredEvents.filter(e => e.severity === 'medium').length;
  const rejCount = filteredEvents.filter(e => e.action === 'rejected').length;
  const isoCount = filteredEvents.filter(e => e.action === 'isolated').length;

  const sevColors: Record<Severity, string> = {
    critical: '#b42318',
    high: '#c2410c',
    medium: '#a16207',
    low: '#1d4ed8',
    info: '#66707d',
  };

  const sevBadges: Record<Severity, string> = {
    critical: 'text-[#b42318] bg-[#b42318]/10 border-[#b42318]/25',
    high: 'text-[#c2410c] bg-[#c2410c]/10 border-[#c2410c]/25',
    medium: 'text-[#a16207] bg-[#a16207]/10 border-[#a16207]/25',
    low: 'text-[#1d4ed8] bg-[#1d4ed8]/10 border-[#1d4ed8]/25',
    info: 'text-[#66707d] bg-[#66707d]/10 border-[#66707d]/25',
  };

  // Severity Breakdown Chart
  const sevBreakdown = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    filteredEvents.forEach(e => {
      counts[e.severity] = (counts[e.severity] || 0) + 1;
    });
    return counts;
  }, [filteredEvents]);

  // Frequent Event Types
  const topTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredEvents.forEach(e => {
      counts[e.type] = (counts[e.type] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [filteredEvents]);

  const copyRawPacket = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSeverity = (sev: Severity) => {
    if (selectedSeverities.includes(sev)) {
      if (selectedSeverities.length > 1) {
        setSelectedSeverities(selectedSeverities.filter(s => s !== sev));
      }
    } else {
      setSelectedSeverities([...selectedSeverities, sev]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters bar */}
      <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-2xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#1f2933]">
          <Filter className="w-4 h-4 text-[#1d4ed8]" /> Event Filters
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Severities Multiselect */}
          <div>
            <label className="text-[11px] font-semibold text-[#66707d] block mb-1">Severities</label>
            <div className="flex flex-wrap gap-1">
              {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map(sev => {
                const active = selectedSeverities.includes(sev);
                return (
                  <button
                    key={sev}
                    onClick={() => toggleSeverity(sev)}
                    className={`px-2 py-0.5 rounded text-xs capitalize font-medium border transition-colors ${
                      active
                        ? `${sevBadges[sev]} font-bold`
                        : 'bg-gray-100 text-[#66707d] border-transparent opacity-60'
                    }`}
                  >
                    {sev}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Meter selector */}
          <div>
            <label className="text-[11px] font-semibold text-[#66707d] block mb-1">Meter ID</label>
            <select
              value={selectedMeter}
              onChange={e => setSelectedMeter(e.target.value)}
              className="w-full text-xs bg-white border border-[#d8dce2] rounded px-2.5 py-1.5 text-[#1f2933] focus:outline-hidden focus:border-[#1d4ed8]"
            >
              <option value="all">All Devices ({metersList.length})</option>
              {metersList.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Action selector */}
          <div>
            <label className="text-[11px] font-semibold text-[#66707d] block mb-1">Action</label>
            <select
              value={selectedAction}
              onChange={e => setSelectedAction(e.target.value)}
              className="w-full text-xs bg-white border border-[#d8dce2] rounded px-2.5 py-1.5 text-[#1f2933] focus:outline-hidden focus:border-[#1d4ed8]"
            >
              <option value="all">All Actions ({actionsList.length})</option>
              {actionsList.map(a => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Filter Stats Counter Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-[#d8dce2] rounded-md p-3 shadow-2xs">
          <div className="text-xs text-[#66707d]">Critical</div>
          <div className="text-xl font-bold text-[#b42318] mt-0.5">{critCount}</div>
          <div className="text-[11px] text-[#66707d]">security alerts</div>
        </div>
        <div className="bg-white border border-[#d8dce2] rounded-md p-3 shadow-2xs">
          <div className="text-xs text-[#66707d]">High</div>
          <div className="text-xl font-bold text-[#c2410c] mt-0.5">{highCount}</div>
          <div className="text-[11px] text-[#66707d]">anomalies</div>
        </div>
        <div className="bg-white border border-[#d8dce2] rounded-md p-3 shadow-2xs">
          <div className="text-xs text-[#66707d]">Medium</div>
          <div className="text-xl font-bold text-[#a16207] mt-0.5">{medCount}</div>
          <div className="text-[11px] text-[#66707d]">warnings</div>
        </div>
        <div className="bg-white border border-[#d8dce2] rounded-md p-3 shadow-2xs">
          <div className="text-xs text-[#66707d]">Rejected</div>
          <div className="text-xl font-bold text-[#1f2933] mt-0.5">{rejCount}</div>
          <div className="text-[11px] text-[#66707d]">packets blocked</div>
        </div>
        <div className="bg-white border border-[#d8dce2] rounded-md p-3 shadow-2xs col-span-2 md:col-span-1">
          <div className="text-xs text-[#66707d]">Isolations</div>
          <div className="text-xl font-bold text-[#1f2933] mt-0.5">{isoCount}</div>
          <div className="text-[11px] text-[#66707d]">devices isolated</div>
        </div>
      </div>

      {/* Visual Analytics row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Severity breakdown bar */}
        <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
          <div className="text-xs font-bold text-[#1f2933] mb-3">Events by Severity</div>
          <div className="space-y-2">
            {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map(sev => {
              const count = sevBreakdown[sev];
              const maxCount = Math.max(1, ...Object.values(sevBreakdown));
              const pct = (count / maxCount) * 100;
              return (
                <div key={sev} className="flex items-center gap-2 text-xs">
                  <span className="w-16 capitalize font-medium text-[#66707d]">{sev}</span>
                  <div className="flex-1 bg-gray-100 h-3 rounded-xs overflow-hidden">
                    <div
                      className="h-full rounded-xs transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: sevColors[sev],
                      }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono font-semibold text-[#1f2933]">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Most frequent event types */}
        <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
          <div className="text-xs font-bold text-[#1f2933] mb-3">Most Frequent Incidents</div>
          {topTypes.length === 0 ? (
            <div className="text-xs text-[#66707d] py-6 text-center">No matching events.</div>
          ) : (
            <div className="space-y-2">
              {topTypes.map(([type, count]) => {
                const maxCount = Math.max(1, ...topTypes.map(t => t[1]));
                const pct = (count / maxCount) * 100;
                return (
                  <div key={type} className="flex items-center gap-2 text-xs">
                    <span className="w-32 truncate font-medium text-[#1f2933]" title={type}>
                      {type.replace(/_/g, ' ')}
                    </span>
                    <div className="flex-1 bg-gray-100 h-3 rounded-xs overflow-hidden">
                      <div
                        className="h-full bg-[#1d4ed8] rounded-xs transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono font-semibold text-[#1f2933]">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Event Details Inspector */}
      {activeEvent && (
        <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
          <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-2 mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#1d4ed8]" /> Event Inspector: #{activeEvent.id}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase border ${sevBadges[activeEvent.severity]}`}>
              {activeEvent.severity}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Structured details */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between py-1 border-b border-[#eceef1]">
                <span className="text-[#66707d]">Timestamp</span>
                <span className="font-mono font-medium text-[#1f2933]">{activeEvent.timeStr}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#eceef1]">
                <span className="text-[#66707d]">Device ID</span>
                <span className="font-mono font-bold text-[#1f2933]">{activeEvent.meter_id || 'unknown'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#eceef1]">
                <span className="text-[#66707d]">Incident Type</span>
                <span className="font-semibold text-[#1f2933]">{activeEvent.type.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#eceef1]">
                <span className="text-[#66707d]">Gateway Action</span>
                <span className="capitalize font-medium text-[#1f2933]">{activeEvent.action}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#eceef1]">
                <span className="text-[#66707d]">Packet Source / Addr</span>
                <span className="font-mono text-[#1f2933]">{activeEvent.source} ({activeEvent.addr})</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#eceef1]">
                <span className="text-[#66707d]">Meter State At Time</span>
                <span className="capitalize text-[#1f2933]">{activeEvent.meter_state}</span>
              </div>
              <div className="pt-2">
                <span className="text-[#66707d] block mb-1">Reason / Finding:</span>
                <p className="bg-gray-50 border border-[#d8dce2] p-2 rounded text-[#1f2933] font-mono text-[11px] leading-relaxed">
                  {activeEvent.reason}
                </p>
              </div>
            </div>

            {/* Raw JSON packet */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold text-[#66707d]">Raw Ingested Packet Payload</span>
                {activeEvent.raw && (
                  <button
                    onClick={() => copyRawPacket(activeEvent.raw)}
                    className="text-[11px] text-[#1d4ed8] hover:underline flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              <pre className="bg-[#1f2933] text-[#f4f5f7] p-3 rounded text-[11px] font-mono overflow-x-auto max-h-56 leading-relaxed">
                {activeEvent.raw
                  ? (() => {
                      try {
                        return JSON.stringify(JSON.parse(activeEvent.raw), null, 2);
                      } catch {
                        return activeEvent.raw;
                      }
                    })()
                  : '(No raw packet data captured for this event)'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Filtered Events Table */}
      <div>
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-3 flex justify-between items-center">
          <span>Security Event Log ({filteredEvents.length} events)</span>
          <span className="text-xs font-normal text-[#66707d]">Click any event row to inspect payload</span>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="text-center py-10 bg-white border border-dashed border-[#d8dce2] rounded text-sm text-[#66707d]">
            No security events match the current filter criteria.
          </div>
        ) : (
          <div className="bg-white border border-[#d8dce2] rounded-md overflow-x-auto shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#fafbfc] border-b border-[#d8dce2] text-[#66707d]">
                  <th className="py-2.5 px-3 font-semibold">Time</th>
                  <th className="py-2.5 px-3 font-semibold">Meter ID</th>
                  <th className="py-2.5 px-3 font-semibold">Severity</th>
                  <th className="py-2.5 px-3 font-semibold">Event Type</th>
                  <th className="py-2.5 px-3 font-semibold">Detail</th>
                  <th className="py-2.5 px-3 font-semibold">Action</th>
                  <th className="py-2.5 px-3 font-semibold">Source</th>
                  <th className="py-2.5 px-3 font-semibold">ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eceef1]">
                {filteredEvents.slice(0, 100).map(e => {
                  const isSelected = activeEvent?.id === e.id;
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setSelectedEventId(e.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/70 font-medium' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="py-2 px-3 font-mono text-[#66707d]">{e.timeStr}</td>
                      <td className="py-2 px-3 font-mono font-medium text-[#1f2933]">{e.meter_id || 'unknown'}</td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${sevBadges[e.severity]}`}>
                          {e.severity}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[#1f2933]">{e.type.replace(/_/g, ' ')}</td>
                      <td className="py-2 px-3 text-[#66707d] max-w-sm truncate">{e.reason}</td>
                      <td className="py-2 px-3 capitalize text-[#1f2933]">{e.action}</td>
                      <td className="py-2 px-3 font-mono text-[#66707d]">{e.addr}</td>
                      <td className="py-2 px-3 font-mono text-[#66707d]">#{e.id}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
