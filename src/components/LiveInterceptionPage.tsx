import React, { useState } from 'react';
import { Crosshair, ShieldCheck, ShieldAlert, AlertTriangle, ArrowRight, Radio, Trash2, X } from 'lucide-react';
import { LiveMitmStatus, LiveMitmLogEntry, MeterInfo } from '../types.js';

interface Props {
  status: LiveMitmStatus | null;
  meters: Record<string, MeterInfo>;
  onStrike: (attack: string, meter: string | null) => Promise<void>;
  onCancel: () => Promise<void>;
  onClear: () => Promise<void>;
}

const ROWS: { key: string; label: string; fmt: (v: any) => string }[] = [
  { key: 'seq', label: 'Sequence', fmt: v => String(v) },
  { key: 'ts', label: 'Timestamp', fmt: v => (v === undefined ? '-' : new Date(Number(v) * 1000).toLocaleTimeString()) },
  { key: 'voltage_v', label: 'Voltage (V)', fmt: v => String(v) },
  { key: 'current_a', label: 'Current (A)', fmt: v => String(v) },
  { key: 'power_kw', label: 'Power (kW)', fmt: v => String(v) },
  { key: 'energy_wh', label: 'Energy (Wh)', fmt: v => String(v) },
  { key: 'temp_c', label: 'Temperature (C)', fmt: v => String(v) },
];

const verdictStyle: Record<string, string> = {
  REJECTED: 'text-[#b42318] bg-[#b42318]/10 border-[#b42318]/30',
  BLOCKED: 'text-[#b42318] bg-[#b42318]/10 border-[#b42318]/30',
  FLAGGED: 'text-[#a16207] bg-[#a16207]/10 border-[#a16207]/30',
  ACCEPTED: 'text-[#15803d] bg-[#15803d]/10 border-[#15803d]/30',
};

function Entry({ e }: { e: LiveMitmLogEntry }) {
  const caught = !e.verdict.accepted || e.verdict.findings.length > 0;
  const changed = new Set(e.changed);
  const sig = (h?: string) => (h ? h.slice(0, 10) + '...' : '-');

  return (
    <div className="bg-white border border-[#d8dce2] rounded-md shadow-2xs overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 border-b border-[#eceef1] bg-gray-50">
        <span className="font-mono text-[11px] text-[#66707d]">{e.time}</span>
        <span className="font-mono text-xs font-bold text-[#1f2933]">{e.meter_id}</span>
        <span className="text-xs font-semibold text-[#b42318] flex items-center gap-1">
          <Crosshair className="w-3.5 h-3.5" /> {e.label}
        </span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#66707d]/10 text-[#66707d] font-semibold">
          {e.manual ? 'manual strike' : 'auto'}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {caught ? <ShieldCheck className="w-4 h-4 text-[#15803d]" /> : <AlertTriangle className="w-4 h-4 text-[#b42318]" />}
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${verdictStyle[e.verdict.label] || verdictStyle.ACCEPTED}`}>
            {e.verdict.label}
          </span>
          <span className="text-[11px] font-semibold text-[#1f2933]">{caught ? 'Attack caught' : 'NOT caught'}</span>
        </span>
      </div>

      <div className="p-3.5 grid md:grid-cols-2 gap-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#66707d]">
                <th className="py-1 pr-2 font-semibold">Field</th>
                <th className="py-1 pr-2 font-semibold">From meter</th>
                <th className="py-1 w-5" />
                <th className="py-1 font-semibold">Attacker sends</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.filter(r => e.original[r.key] !== undefined).map(r => {
                const diff = changed.has(r.key);
                return (
                  <tr key={r.key} className="border-t border-[#eceef1]">
                    <td className="py-1 pr-2 text-[#66707d]">{r.label}</td>
                    <td className="py-1 pr-2 font-mono">{r.fmt(e.original[r.key])}</td>
                    <td className="py-1 text-[#66707d]">{diff && <ArrowRight className="w-3 h-3" />}</td>
                    <td className={`py-1 font-mono ${diff ? 'bg-[#b42318]/10 text-[#b42318] font-bold px-1.5 rounded' : 'text-[#66707d]'}`}>
                      {r.fmt(e.modified[r.key])}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-[#eceef1]">
                <td className="py-1 pr-2 text-[#66707d]">Signature</td>
                <td className="py-1 pr-2 font-mono">{sig(e.original.hmac)}</td>
                <td className="py-1 text-[#66707d]">{changed.has('hmac') && <ArrowRight className="w-3 h-3" />}</td>
                <td className={`py-1 font-mono ${changed.has('hmac') ? 'bg-[#b42318]/10 text-[#b42318] font-bold px-1.5 rounded' : 'text-[#66707d]'}`}>
                  {sig(e.modified.hmac)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-[#66707d] mt-2 leading-snug">{e.signature_note}</p>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-[#66707d] mb-1.5">What the gateway concluded</div>
          {e.verdict.findings.length === 0 ? (
            <p className="text-xs text-[#b42318] font-semibold">No findings. The gateway accepted this packet.</p>
          ) : (
            <ul className="space-y-1.5">
              {e.verdict.findings.map((f, i) => (
                <li key={i} className="text-xs leading-snug">
                  <span className="font-mono font-bold text-[#1f2933]">{f.type}</span>
                  <span className="text-[#66707d]"> - {f.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {e.delivered > 1 && (
            <p className="text-[11px] text-[#66707d] mt-2">The genuine packet was delivered first, then the attacker injected this one.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function LiveInterceptionPage({ status, meters, onStrike, onCancel, onClear }: Props) {
  const [attack, setAttack] = useState('auto');
  const [meter, setMeter] = useState('');
  const [busy, setBusy] = useState(false);

  const attacks = status?.attacks || [];
  const selected = attacks.find(a => a.key === attack);
  const pending = status?.pending_strike;
  const liveMeters = Object.values(meters).filter(m => m.data_source === 'wokwi');
  const log = status?.log || [];

  const strike = async () => {
    setBusy(true);
    try {
      await onStrike(attack, meter || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-[#1f2933] flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-[#b42318]" /> Live interception - you are the attacker
            </h2>
            <p className="text-xs text-[#66707d] mt-1 max-w-2xl leading-snug">
              Readings from the Wokwi meters pass through you on the way to the gateway. Pick an attack and strike the next
              live packet. Below you can see exactly what you changed and how the gateway reacted.
            </p>
          </div>
          <div className="flex gap-4 text-center">
            <div><div className="text-lg font-bold text-[#1f2933]">{status?.intercepted ?? 0}</div><div className="text-[10px] uppercase text-[#66707d]">Intercepted</div></div>
            <div><div className="text-lg font-bold text-[#b42318]">{status?.attacked ?? 0}</div><div className="text-[10px] uppercase text-[#66707d]">Attacked</div></div>
            <div><div className="text-lg font-bold text-[#15803d]">{status?.caught ?? 0}</div><div className="text-[10px] uppercase text-[#66707d]">Caught</div></div>
            <div><div className="text-lg font-bold text-[#a16207]">{status?.missed ?? 0}</div><div className="text-[10px] uppercase text-[#66707d]">Missed</div></div>
          </div>
        </div>

        <div className="mt-4 grid md:grid-cols-[1fr_200px_auto] gap-3 items-end">
          <label className="text-xs text-[#1f2933]">
            <span className="block font-semibold mb-1">Attack</span>
            <select value={attack} onChange={e => setAttack(e.target.value)} className="w-full border border-[#d8dce2] rounded p-2 bg-white text-xs">
              <option value="auto">Auto (next in rotation)</option>
              {attacks.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#1f2933]">
            <span className="block font-semibold mb-1">Target meter</span>
            <select value={meter} onChange={e => setMeter(e.target.value)} className="w-full border border-[#d8dce2] rounded p-2 bg-white text-xs">
              <option value="">Any live meter</option>
              {Object.keys(meters).map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <button
            onClick={strike}
            disabled={busy}
            className="bg-[#b42318] hover:bg-[#912018] disabled:opacity-60 text-white text-xs font-bold px-4 py-2.5 rounded flex items-center justify-center gap-2 cursor-pointer"
          >
            <Crosshair className="w-4 h-4" /> Strike next live packet
          </button>
        </div>
        {selected && <p className="text-[11px] text-[#66707d] mt-2">{selected.summary}</p>}

        {pending && (
          <div className="mt-3 flex items-center justify-between gap-3 bg-[#a16207]/10 border border-[#a16207]/30 rounded px-3 py-2 text-xs text-[#a16207]">
            <span className="flex items-center gap-2 font-semibold">
              <Radio className="w-4 h-4 animate-pulse" />
              Armed: will attack the next live packet{pending.meter ? ` from ${pending.meter}` : ''} ({pending.attack === 'auto' ? 'auto' : attacks.find(a => a.key === pending.attack)?.label || pending.attack})
            </span>
            <button onClick={onCancel} className="flex items-center gap-1 font-semibold hover:underline cursor-pointer">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        )}
        {liveMeters.length === 0 && (
          <p className="mt-3 text-xs text-[#66707d] flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            No Wokwi meter is live right now. Start the simulators and <span className="font-mono">npm run bridge</span>; a strike waits for the next live packet.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#66707d]">Intercepted packets (newest first)</h3>
        {log.length > 0 && (
          <button onClick={onClear} className="text-xs text-[#66707d] hover:text-[#b42318] flex items-center gap-1 cursor-pointer">
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {log.length === 0 ? (
        <div className="bg-white border border-dashed border-[#d8dce2] rounded-md p-8 text-center text-xs text-[#66707d]">
          <ShieldAlert className="w-5 h-5 mx-auto mb-2 opacity-60" />
          Nothing intercepted yet. Strike a live packet, or leave the automatic attacker on.
        </div>
      ) : (
        <div className="space-y-3">{log.map(e => <Entry key={e.id} e={e} />)}</div>
      )}
    </div>
  );
}
