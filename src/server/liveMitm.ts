// Live man-in-the-middle: an attacker sitting on the wire between the (Wokwi) meters and the
// gateway. It sees every real packet, and for some of them it tampers, replays or forges
// before the gateway ever verifies it. The gateway's job is to catch all of it.
//
// Only packets with source "serial" (i.e. from the Wokwi bridge) pass through here.
// Built-in simulator traffic and the Attack Lab are not touched.

import { METERS_REGISTRY } from './engine.js';
import { formatPacket } from './simulator.js';
import type { Verdict } from '../types.js';

export type LiveMitmAttack =
  | 'current_power'
  | 'voltage_inject'
  | 'energy_rollback'
  | 'stale_timestamp'
  | 'seq_replay'
  | 'forged_key';

export const LIVE_MITM_ATTACKS: { key: LiveMitmAttack; label: string; summary: string; signature: string }[] = [
  { key: 'current_power', label: 'Under-report usage', summary: 'Current and power cut to ~35% in transit (energy theft). Signature no longer matches.', signature: 'Original signature kept - does not match the edited values' },
  { key: 'voltage_inject', label: 'False voltage injection', summary: 'Voltage rewritten to 265 V in transit. Signature no longer matches.', signature: 'Original signature kept - does not match the edited values' },
  { key: 'energy_rollback', label: 'Energy register rollback', summary: 'Cumulative energy rewritten to 15% of its value. Signature no longer matches.', signature: 'Original signature kept - does not match the edited values' },
  { key: 'stale_timestamp', label: 'Stale timestamp', summary: 'Timestamp pushed 10 minutes into the past. Signature no longer matches.', signature: 'Original signature kept - does not match the edited timestamp' },
  { key: 'seq_replay', label: 'Replay old packet', summary: 'A previously captured genuine packet is re-sent after the real one.', signature: 'Genuine old packet - signature valid, but its sequence number was already used' },
  { key: 'forged_key', label: 'Forged with stolen key', summary: 'Current x3.2, correctly re-signed with the meter key. Passes the HMAC check, so only behaviour/physics checks can catch it.', signature: 'Re-signed with the stolen meter key - signature is VALID' },
];

export interface LiveMitmPlan {
  attack: LiveMitmAttack | null;
  label: string;
  deliver: string[]; // raw lines that actually reach the gateway, in order
  original?: Record<string, any>; // the genuine packet as the meter sent it
  manual?: boolean; // triggered by the Strike button
}

export interface LiveMitmLogEntry {
  id: number;
  time: string;
  meter_id: string;
  attack: string;
  label: string;
  summary: string;
  signature_note: string;
  manual: boolean;
  original: Record<string, any>;
  modified: Record<string, any>;
  changed: string[];
  delivered: number;
  verdict: { label: string; accepted: boolean; findings: { severity: string; type: string; reason: string }[] };
}

const SHOWN_FIELDS = ['seq', 'ts', 'temp_c', 'voltage_v', 'current_a', 'power_kw', 'energy_wh', 'hmac'];

function pickShown(o: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of SHOWN_FIELDS) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

// Edit one field in the raw JSON text without disturbing anything else (HMAC left untouched).
function setField(raw: string, key: string, value: string | number): string {
  const re = new RegExp('("' + key + '"\\s*:\\s*)([^,}\\s]+)');
  return raw.replace(re, (_m, p1) => p1 + String(value));
}

export class LiveMitm {
  public enabled = true;
  public mode: LiveMitmAttack | 'auto' = 'auto';
  public rate = 0.35; // chance that a given live packet is attacked
  public intercepted = 0;
  public attacked = 0;
  public byAttack: Record<string, number> = {};
  public last: { time: string; meter_id: string; attack: string; label: string } | null = null;
  public caught = 0;
  public missed = 0;
  public pendingStrike: { attack: LiveMitmAttack | 'auto'; meter: string | null } | null = null;
  public log: LiveMitmLogEntry[] = [];
  private logId = 0;

  private history: Map<string, string[]> = new Map();
  private rotation = 0;

  reset() {
    this.history.clear();
    this.intercepted = 0;
    this.attacked = 0;
    this.byAttack = {};
    this.last = null;
    this.rotation = 0;
    this.caught = 0;
    this.missed = 0;
    this.pendingStrike = null;
    this.log = [];
  }

  clearLog() {
    this.log = [];
    this.attacked = 0;
    this.intercepted = 0;
    this.byAttack = {};
    this.caught = 0;
    this.missed = 0;
    this.last = null;
  }

  arm(attack: LiveMitmAttack | 'auto', meter: string | null) {
    this.pendingStrike = { attack, meter };
  }

  disarm() {
    this.pendingStrike = null;
  }

  status() {
    return {
      enabled: this.enabled,
      mode: this.mode,
      rate: this.rate,
      intercepted: this.intercepted,
      attacked: this.attacked,
      caught: this.caught,
      missed: this.missed,
      by_attack: this.byAttack,
      last: this.last,
      pending_strike: this.pendingStrike,
      log: this.log,
      attacks: LIVE_MITM_ATTACKS,
    };
  }

  private pickAttack(): LiveMitmAttack {
    if (this.mode !== 'auto') return this.mode;
    const a = LIVE_MITM_ATTACKS[this.rotation % LIVE_MITM_ATTACKS.length].key;
    this.rotation++;
    return a;
  }

  // Decide what the attacker does with one genuine packet coming off the wire.
  intercept(raw: string): LiveMitmPlan {
    this.intercepted++;

    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      return { attack: null, label: 'pass-through', deliver: [raw] };
    }
    const id: string = String(obj.meter_id || '');
    const hist = this.history.get(id) || [];

    const pass: LiveMitmPlan = { attack: null, label: 'pass-through', deliver: [raw] };
    const strike = this.pendingStrike;
    const strikeNow = !!strike && (!strike.meter || strike.meter === id) && hist.length >= 1;
    const remember = () => {
      hist.push(raw);
      if (hist.length > 8) hist.shift();
      this.history.set(id, hist);
    };

    // Let a few genuine packets through first so there is something to replay / compare against.
    if (!strikeNow && (!this.enabled || hist.length < 3 || Math.random() >= this.rate)) {
      remember();
      return pass;
    }

    let attack: LiveMitmAttack;
    if (strikeNow) {
      attack = strike!.attack === 'auto' ? this.pickAttack() : strike!.attack;
      this.pendingStrike = null;
    } else {
      attack = this.pickAttack();
    }
    const info = LIVE_MITM_ATTACKS.find(a => a.key === attack)!;
    let deliver: string[] = [];

    switch (attack) {
      case 'current_power': {
        let r = setField(raw, 'current_a', (Number(obj.current_a) * 0.35).toFixed(2));
        r = setField(r, 'power_kw', (Number(obj.power_kw) * 0.35).toFixed(2));
        deliver = [r];
        break;
      }
      case 'voltage_inject':
        deliver = [setField(raw, 'voltage_v', '265.0')];
        break;
      case 'energy_rollback':
        deliver = [setField(raw, 'energy_wh', (Number(obj.energy_wh) * 0.15).toFixed(2))];
        break;
      case 'stale_timestamp':
        if (obj.ts === undefined) {
          remember();
          return pass;
        }
        deliver = [setField(raw, 'ts', Number(obj.ts) - 600)];
        break;
      case 'seq_replay': {
        // genuine packet goes through, then the attacker injects an old captured one
        const old = hist[Math.max(0, hist.length - 3)];
        deliver = [raw, old];
        break;
      }
      case 'forged_key': {
        if (!METERS_REGISTRY[id]) {
          remember();
          return pass;
        }
        const cur = Number(obj.current_a) * 3.2;
        const volt = Number(obj.voltage_v);
        deliver = [
          formatPacket(id, Number(obj.seq), Number(obj.temp_c), volt, cur, {
            power: (volt * cur) / 1000,
            energy_wh: obj.energy_wh !== undefined ? Number(obj.energy_wh) : undefined,
            ts: obj.ts !== undefined ? Number(obj.ts) : undefined,
            alert: false,
            key: 'auto',
          }),
        ];
        break;
      }
    }

    remember();
    this.attacked++;
    this.byAttack[attack] = (this.byAttack[attack] || 0) + 1;
    this.last = { time: new Date().toTimeString().split(' ')[0], meter_id: id, attack, label: info.label };
    return { attack, label: info.label, deliver, original: obj, manual: strikeNow };
  }

  // Called after the gateway has judged the attacker's packet.
  record(plan: LiveMitmPlan, verdict: Verdict) {
    if (!plan.attack || !plan.original) return;
    let modified: Record<string, any> = {};
    try {
      modified = JSON.parse(plan.deliver[plan.deliver.length - 1]);
    } catch {
      /* leave empty */
    }
    const original = pickShown(plan.original);
    const mod = pickShown(modified);
    const changed = SHOWN_FIELDS.filter(k => String(original[k]) !== String(mod[k]) && k !== 'hmac');
    if (original.hmac !== mod.hmac) changed.push('hmac');
    const info = LIVE_MITM_ATTACKS.find(a => a.key === plan.attack)!;
    const caught = !verdict.accepted || verdict.findings.length > 0;
    if (caught) this.caught++;
    else this.missed++;
    this.log.unshift({
      id: ++this.logId,
      time: new Date().toTimeString().split(' ')[0],
      meter_id: String(plan.original.meter_id || ''),
      attack: plan.attack,
      label: info.label,
      summary: info.summary,
      signature_note: info.signature,
      manual: !!plan.manual,
      original,
      modified: mod,
      changed,
      delivered: plan.deliver.length,
      verdict: {
        label: verdict.label,
        accepted: verdict.accepted,
        findings: verdict.findings.map(f => ({ severity: f.severity, type: f.type, reason: f.reason })),
      },
    });
    if (this.log.length > 40) this.log.pop();
  }
}
