import crypto from 'crypto';
import { Severity, Finding, Verdict, TelemetryPoint, SecurityEvent, MeterInfo, GridStats } from '../types.js';

export const METERS_REGISTRY: Record<string, { name: string; site: string; firmware: string; key: string }> = {
  'MTR-001': {
    name: 'Meter A',
    site: 'Feeder 1 · Transformer T1',
    firmware: 'r1.0',
    key: process.env.GG_KEY_MTR001 || 'GG_KEY_MTR001',
  },
  'MTR-002': {
    name: 'Meter B',
    site: 'Feeder 2 · Transformer T2',
    firmware: 'r1.0',
    key: process.env.GG_KEY_MTR002 || 'GG_KEY_MTR002',
  },
};

export const LIMITS = {
  volt_warn: [216.0, 244.0] as [number, number],
  volt_crit: [200.0, 255.0] as [number, number],
  cur_warn: 3.5,
  cur_crit: 8.0,
  temp_warn: 33.0,
  temp_crit: 42.0,
  pow_warn: 0.8,
  pow_crit: 1.8,
  volt_abs: [0.0, 1000.0] as [number, number],
  cur_abs: [0.0, 100.0] as [number, number],
  temp_abs: [-40.0, 150.0] as [number, number],
  rate_window: 5.0, // seconds
  rate_max: 8, // packets per window
  max_skew: 30.0, // seconds allowed clock difference
  spike_factor: 2.5,
  spike_min_delta: 0.3,
  energy_tolerance: 0.005,
  strike_window: 60.0, // auto-isolation: strikes inside this window
};

const SEV_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SIGNED_FIELDS = ['meter_id', 'seq', 'ts', 'temp_c', 'voltage_v', 'current_a', 'power_kw', 'alert', 'energy_wh'];

export function canonical(packet: Record<string, any>, _raw?: string): string {
  if (packet.alert === 'false') packet.alert = false;
  const canonical = [
    packet.meter_id,
    packet.seq,
    packet.ts,
    Number(packet.temp_c).toFixed(2),
    Number(packet.voltage_v).toFixed(2),
    Number(packet.current_a).toFixed(3),
    Number(packet.power_kw).toFixed(4),
    packet.alert ? "true" : "false",
    Number(packet.energy_wh).toFixed(2),
  ].join("|");
  return canonical;
}

export function signHmac(data: Record<string, any>, key: string, _raw?: string): string {
  const message = canonical(data);
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

export class GridGuardEngine {
  public auto_isolate: boolean = true;
  public auto_isolate_strikes: number = 3;
  public strict_hmac: boolean = false;
  public check_timestamp: boolean = true;

  private telemetryList: TelemetryPoint[] = [];
  private eventList: SecurityEvent[] = [];
  private metersState: Map<string, {
    meter_id: string;
    status: 'online' | 'isolated';
    last_seen: number | null;
    last_seq: number;
    energy_wh: number;
    reported_wh: number | null;
    accepted: number;
    rejected: number;
    blocked: number;
    isolated_reason: string | null;
  }> = new Map();

  private counters: Record<string, number> = {
    accepted: 0,
    rejected: 0,
    blocked: 0,
  };

  private rateWindows: Map<string, number[]> = new Map();
  private strikesWindows: Map<string, number[]> = new Map();
  private lastRateEvent: Map<string, number> = new Map();
  public simLast: Map<string, number> = new Map();
  // Last time a real (Wokwi / serial) packet arrived for each meter. While a meter is
  // live, the built-in simulator steps aside for that meter and resumes when it goes quiet.
  private liveSource = new Map<string, 'arduino' | 'wokwi'>();
  private liveLast: Map<string, number> = new Map();
  public static readonly LIVE_TIMEOUT_S = 8;

  private nextTelemetryId = 1;
  private nextEventId = 1;

  constructor() {
    this.initMeters();
  }

  private initMeters() {
    for (const mid of Object.keys(METERS_REGISTRY)) {
      if (!this.metersState.has(mid)) {
        this.metersState.set(mid, {
          meter_id: mid,
          status: 'online',
          last_seen: null,
          last_seq: 0,
          energy_wh: 0.0,
          reported_wh: null,
          accepted: 0,
          rejected: 0,
          blocked: 0,
          isolated_reason: null,
        });
      }
    }
  }

  public reset(): void {
    this.telemetryList = [];
    this.eventList = [];
    this.counters = { accepted: 0, rejected: 0, blocked: 0 };
    this.rateWindows.clear();
    this.strikesWindows.clear();
    this.lastRateEvent.clear();
    this.simLast.clear();
    this.liveLast.clear();
    this.liveSource.clear();
    this.metersState.clear();
    this.nextTelemetryId = 1;
    this.nextEventId = 1;
    this.initMeters();
  }

  private bump(key: string, n = 1) {
    this.counters[key] = (this.counters[key] || 0) + n;
  }

  private formatTime(ts: number): string {
    const d = new Date(ts * 1000);
    return d.toTimeString().split(' ')[0];
  }

  private logEvent(
    ts: number,
    meter_id: string,
    sev: Severity,
    type: string,
    reason: string,
    source: string,
    action: SecurityEvent['action'],
    raw: string,
    addr: string
  ): void {
    const m = this.metersState.get(meter_id);
    const meter_state = m ? m.status : 'unregistered';
    const evt: SecurityEvent = {
      id: this.nextEventId++,
      ts,
      timeStr: this.formatTime(ts),
      meter_id,
      severity: sev,
      type,
      reason,
      source,
      action,
      raw: (raw || '').slice(0, 2000),
      addr,
      meter_state,
    };
    this.eventList.unshift(evt);
    if (this.eventList.length > 3000) {
      this.eventList.pop();
    }
  }

  private reject(
    v: Verdict,
    sev: Severity,
    type: string,
    reason: string,
    source: string,
    addr: string,
    now: number
  ): Verdict {
    v.accepted = false;
    v.findings.push({ severity: sev, type, reason });
    v.severity = this.calcVerdictSeverity(v.findings);
    v.label = 'REJECTED';

    this.logEvent(now, v.meter_id || 'unknown', sev, type, reason, source, 'rejected', v.raw, addr);
    this.bump('rejected');
    if (v.meter_id && this.metersState.has(v.meter_id)) {
      const m = this.metersState.get(v.meter_id)!;
      m.rejected += 1;
    }
    return v;
  }

  private calcVerdictSeverity(findings: Finding[]): Severity {
    if (!findings.length) return 'info';
    let highest: Severity = 'info';
    for (const f of findings) {
      if (SEV_RANK[f.severity] > SEV_RANK[highest]) {
        highest = f.severity;
      }
    }
    return highest;
  }

  public ingest(packet: string | Record<string, unknown>, source = 'serial', addr?: string): Verdict {
    const now = Date.now() / 1000;
    const packetAddr = addr || source;
    const raw = (typeof packet === 'string' ? packet : JSON.stringify(packet)).trim();
    const v: Verdict = {
      raw,
      meter_id: null,
      accepted: false,
      blocked: false,
      authenticated: null,
      isolated_now: false,
      findings: [],
      severity: 'info',
      label: 'REJECTED',
    };

    // 1. parse JSON
    let data: Record<string, unknown>;
    try {
      data = typeof packet === 'string' ? JSON.parse(raw) : packet;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Not object');
      }
    } catch {
      return this.reject(v, 'medium', 'malformed_json', 'Packet is not a valid JSON object', source, packetAddr, now);
    }

    const meter_id = String(data.meter_id || '').slice(0, 40);
    v.meter_id = meter_id || null;
    if (!meter_id) {
      return this.reject(v, 'medium', 'malformed_packet', 'Packet has no meter_id', source, packetAddr, now);
    }

    // 2. allow-list
    if (!METERS_REGISTRY[meter_id]) {
      return this.reject(
        v,
        'critical',
        'unauthorized_device',
        `Meter ID '${meter_id}' is not in the device allow-list`,
        source,
        packetAddr,
        now
      );
    }

    // HTTP hardware ingest uses the arduino transport and carries source in JSON.
    const isArduinoLive = source === 'arduino-live' ||
      (source === 'arduino' && data.source === 'arduino-live');
    if (source === 'serial' || source === 'arduino' || isArduinoLive) {
      this.liveSource.set(meter_id, source === 'arduino' || isArduinoLive ? 'arduino' : 'wokwi');
      this.liveLast.set(meter_id, now);
    }

    // 3. isolation check
    const m = this.metersState.get(meter_id)!;
    if (m.status === 'isolated') {
      m.blocked += 1;
      this.bump('blocked');
      v.blocked = true;
      v.label = 'BLOCKED';
      return v;
    }

    // 4. rate limit (applied to live network and serial ingest, bypassed in controlled lab simulation)
    if (source !== 'mitm-interceptor' && source !== 'attack-sim') {
      let dq = this.rateWindows.get(meter_id);
      if (!dq) {
        dq = [];
        this.rateWindows.set(meter_id, dq);
      }
      dq.push(now);
      while (dq.length > 0 && now - dq[0] > LIMITS.rate_window) {
        dq.shift();
      }

      if (dq.length > LIMITS.rate_max) {
        const lastEv = this.lastRateEvent.get(meter_id) || 0;
        if (now - lastEv > LIMITS.rate_window) {
          this.lastRateEvent.set(meter_id, now);
          return this.reject(
            v,
            'high',
            'message_flood',
            `${dq.length} packets in ${LIMITS.rate_window.toFixed(0)}s (limit ${LIMITS.rate_max}) - possible flooding / DoS`,
            source,
            packetAddr,
            now
          );
        }
        this.bump('rejected');
        m.rejected += 1;
        v.accepted = false;
        v.findings.push({ severity: 'high', type: 'message_flood', reason: 'Dropped - rate limit still exceeded' });
        v.severity = 'high';
        v.label = 'REJECTED';
        return v;
      }
    }

    // 5. HMAC
    const sig = data.hmac;
    if (sig === undefined || sig === null || sig === '') {
      if (this.strict_hmac) {
        return this.reject(v, 'high', 'hmac_missing', 'Unsigned packet rejected (strict HMAC mode)', source, packetAddr, now);
      }
      v.authenticated = false;
    } else {
      const packetData = data as Record<string, any>;
      if (packetData.alert === 'false') packetData.alert = false;
      const canonical = [
        packetData.meter_id,
        packetData.seq,
        packetData.ts,
        Number(packetData.temp_c).toFixed(2),
        Number(packetData.voltage_v).toFixed(2),
        Number(packetData.current_a).toFixed(3),
        Number(packetData.power_kw).toFixed(4),
        packetData.alert ? "true" : "false",
        Number(packetData.energy_wh).toFixed(2),
      ].join("|");

      const key = meter_id === 'MTR-001'
        ? (process.env.GG_KEY_MTR001 || 'GG_KEY_MTR001')
        : meter_id === 'MTR-002'
        ? (process.env.GG_KEY_MTR002 || 'GG_KEY_MTR002')
        : (METERS_REGISTRY[meter_id]?.key || '');

      const expected = crypto.createHmac('sha256', key).update(canonical).digest('hex');

      if (source !== 'simulator') {
        console.log('[DEBUG HMAC Verification]');
        console.log('1. The received packet:', packet);
        console.log('2. The gateway-reconstructed canonical string:', canonical);
        console.log('3. The gateway-calculated HMAC:', expected);
        console.log('4. The HMAC received from Arduino:', sig);
      }

      const isMatch = typeof sig === 'string' && sig.toLowerCase() === expected.toLowerCase();
      if (!isMatch) {
        return this.reject(v, 'critical', 'invalid_hmac', 'HMAC signature mismatch - message altered or wrong key', source, packetAddr, now);
      }
      v.authenticated = true;
    }

    // 6. replay
    let seq: number | null = null;
    if (data.seq !== undefined && data.seq !== null && data.seq !== '') {
      seq = Number(data.seq);
      if (isNaN(seq) || !Number.isInteger(seq)) {
        return this.reject(v, 'medium', 'malformed_packet', 'Invalid sequence number', source, packetAddr, now);
      }
      if (seq <= (m.last_seq || 0)) {
        return this.reject(v, 'high', 'replay_detected', `Sequence ${seq} already used (last accepted ${m.last_seq})`, source, packetAddr, now);
      }
    }

    if (this.check_timestamp && data.ts !== undefined && data.ts !== null && data.ts !== '') {
      const pktTs = Number(data.ts);
      if (isNaN(pktTs)) {
        return this.reject(v, 'medium', 'malformed_packet', 'Invalid timestamp', source, packetAddr, now);
      }
      const skew = Math.abs(now - pktTs);
      if (skew > LIMITS.max_skew) {
        return this.reject(
          v,
          'high',
          'stale_timestamp',
          `Timestamp is ${skew.toFixed(0)}s off (limit ${LIMITS.max_skew.toFixed(0)}s) - possible replay`,
          source,
          packetAddr,
          now
        );
      }
    }

    // 7. values
    const temp = Number(data.temp_c);
    const volt = Number(data.voltage_v);
    const cur = Number(data.current_a);
    const pw = data.power_kw;
    const power = pw !== undefined && pw !== null && pw !== '' ? Number(pw) : (volt * cur) / 1000.0;

    if (isNaN(temp) || isNaN(volt) || isNaN(cur) || isNaN(power)) {
      return this.reject(v, 'medium', 'malformed_packet', 'Missing or non-numeric temp_c / voltage_v / current_a', source, packetAddr, now);
    }
    if (!Number.isFinite(temp) || !Number.isFinite(volt) || !Number.isFinite(cur) || !Number.isFinite(power)) {
      return this.reject(v, 'medium', 'malformed_packet', 'NaN / infinite reading', source, packetAddr, now);
    }

    let reported: number | null = null;
    if (data.energy_wh !== undefined && data.energy_wh !== null && data.energy_wh !== '') {
      reported = Number(data.energy_wh);
      if (isNaN(reported) || !Number.isFinite(reported) || reported < 0) {
        return this.reject(v, 'medium', 'malformed_packet', 'Invalid energy_wh value', source, packetAddr, now);
      }
    }

    const bad: string[] = [];
    if (volt < LIMITS.volt_abs[0] || volt > LIMITS.volt_abs[1]) bad.push(`voltage ${volt} V`);
    if (cur < LIMITS.cur_abs[0] || cur > LIMITS.cur_abs[1]) bad.push(`current ${cur} A`);
    if (temp < LIMITS.temp_abs[0] || temp > LIMITS.temp_abs[1]) bad.push(`temperature ${temp} °C`);
    if (power < 0) bad.push(`power ${power} kW`);

    if (bad.length > 0) {
      return this.reject(
        v,
        'critical',
        'impossible_reading',
        `Physically impossible value(s): ${bad.join(', ')} - sensor tampering?`,
        source,
        packetAddr,
        now
      );
    }

    // Threshold & consistency checks
    const f = v.findings;
    const L = LIMITS;

    if (volt < L.volt_crit[0] || volt > L.volt_crit[1]) {
      f.push({ severity: 'critical', type: 'voltage_critical', reason: `Voltage ${volt.toFixed(1)} V outside ${L.volt_crit[0]}-${L.volt_crit[1]} V` });
    } else if (volt < L.volt_warn[0] || volt > L.volt_warn[1]) {
      f.push({ severity: 'medium', type: 'voltage_warning', reason: `Voltage ${volt.toFixed(1)} V outside normal band ${L.volt_warn[0]}-${L.volt_warn[1]} V` });
    }

    if (cur > L.cur_crit) {
      f.push({ severity: 'critical', type: 'current_critical', reason: `Current spike ${cur.toFixed(2)} A (limit ${L.cur_crit} A)` });
    } else if (cur > L.cur_warn) {
      f.push({ severity: 'medium', type: 'current_warning', reason: `Elevated current ${cur.toFixed(2)} A (warn ${L.cur_warn.toFixed(1)} A)` });
    }

    if (temp > L.temp_crit) {
      f.push({ severity: 'critical', type: 'temperature_critical', reason: `Temperature ${temp.toFixed(1)} °C (limit ${L.temp_crit} °C)` });
    } else if (temp > L.temp_warn) {
      f.push({ severity: 'medium', type: 'temperature_warning', reason: `Temperature ${temp.toFixed(1)} °C (warn ${L.temp_warn.toFixed(0)} °C)` });
    }

    if (power > L.pow_crit) {
      f.push({ severity: 'critical', type: 'power_critical', reason: `Power ${power.toFixed(2)} kW (limit ${L.pow_crit.toFixed(1)} kW)` });
    } else if (power > L.pow_warn) {
      f.push({ severity: 'medium', type: 'power_warning', reason: `Power ${power.toFixed(2)} kW (warn ${L.pow_warn.toFixed(1)} kW)` });
    }

    const apparent = (volt * cur) / 1000.0;
    if (power > apparent * 1.05 + 0.02) {
      f.push({ severity: 'high', type: 'power_mismatch', reason: `Reported ${power.toFixed(2)} kW exceeds V×I = ${apparent.toFixed(2)} kW (physically impossible)` });
    }

    const prev_wh = m.reported_wh;
    if (reported !== null && prev_wh !== null && reported < prev_wh - L.energy_tolerance) {
      f.push({ severity: 'high', type: 'energy_rollback', reason: `Cumulative energy fell from ${prev_wh.toFixed(2)} Wh to ${reported.toFixed(2)} Wh (meter register rolled back?)` });
    }

    if (data.alert === true) {
      f.push({ severity: 'medium', type: 'meter_reported_alert', reason: 'Meter raised its own tamper / fault alert' });
    }

    // Sudden spike check
    const recentPowers: number[] = [];
    for (const pt of this.telemetryList) {
      if (pt.meter_id === meter_id && !pt.flagged) {
        recentPowers.push(pt.power_kw);
        if (recentPowers.length >= 10) break;
      }
    }
    if (recentPowers.length >= 3) {
      const mean = recentPowers.reduce((a, b) => a + b, 0) / recentPowers.length;
      if (power > mean * L.spike_factor && power - mean > L.spike_min_delta) {
        f.push({ severity: 'medium', type: 'sudden_spike', reason: `Power jumped to ${power.toFixed(2)} kW vs recent average ${mean.toFixed(2)} kW` });
      }
    }

    // Accept and store
    const dt = m.last_seen ? Math.min(now - m.last_seen, 10.0) : 0.0;
    const energy = (m.energy_wh || 0.0) + (power * 1000.0 * dt) / 3600.0;

    const hasFindings = f.length > 0;
    const point: TelemetryPoint = {
      id: this.nextTelemetryId++,
      ts: now,
      timeStr: this.formatTime(now),
      meter_id,
      temp_c: temp,
      voltage_v: volt,
      current_a: cur,
      power_kw: power,
      energy_wh: energy,
      seq,
      flagged: hasFindings,
      raw: raw.slice(0, 2000),
      reported_wh: reported,
      source,
    };

    this.telemetryList.unshift(point);
    if (this.telemetryList.length > 5000) {
      this.telemetryList.pop();
    }

    if (reported !== null && (prev_wh === null || reported >= prev_wh - L.energy_tolerance)) {
      m.reported_wh = reported;
    }

    m.last_seen = now;
    if (seq !== null) {
      m.last_seq = seq;
    }
    m.energy_wh = energy;
    m.accepted += 1;
    this.bump('accepted');

    v.accepted = true;
    v.severity = this.calcVerdictSeverity(f);
    v.label = hasFindings ? 'FLAGGED' : 'ACCEPTED';

    for (const fi of f) {
      this.logEvent(now, meter_id, fi.severity, fi.type, fi.reason, source, 'flagged', raw, packetAddr);
    }

    // 8. Auto-isolation
    if (hasFindings && SEV_RANK[v.severity] >= SEV_RANK.high && this.auto_isolate) {
      let st = this.strikesWindows.get(meter_id);
      if (!st) {
        st = [];
        this.strikesWindows.set(meter_id, st);
      }
      st.push(now);
      while (st.length > 0 && now - st[0] > L.strike_window) {
        st.shift();
      }
      if (st.length >= this.auto_isolate_strikes) {
        this.isolateInternal(meter_id, `Auto-isolated: ${st.length} critical packets in ${L.strike_window.toFixed(0)}s`, 'gateway', now);
        v.isolated_now = true;
      }
    }

    return v;
  }

  private isolateInternal(meter_id: string, reason: string, by: string, now: number) {
    const m = this.metersState.get(meter_id);
    if (m) {
      m.status = 'isolated';
      m.isolated_reason = reason;
    }
    this.logEvent(now, meter_id, 'high', 'meter_isolated', reason, by, 'isolated', '', 'internal');
    this.strikesWindows.delete(meter_id);
  }

  public isolate(meter_id: string, reason = 'Manually isolated by operator'): void {
    const now = Date.now() / 1000;
    this.isolateInternal(meter_id, reason, 'operator', now);
  }

  public restore(meter_id: string): void {
    const now = Date.now() / 1000;
    const m = this.metersState.get(meter_id);
    if (m) {
      m.status = 'online';
      m.isolated_reason = null;
    }
    this.logEvent(now, meter_id, 'info', 'meter_restored', 'Meter restored to service by operator', 'operator', 'restored', '', 'operator-ui');
    this.strikesWindows.delete(meter_id);
  }

  public getTelemetry(sinceSeconds?: number, limit = 4000): TelemetryPoint[] {
    const now = Date.now() / 1000;
    let items = this.telemetryList;
    if (sinceSeconds) {
      const minTs = now - sinceSeconds;
      items = items.filter(t => t.ts >= minTs);
    }
    return items.slice(0, limit).reverse(); // Return in chronological order
  }

  public getEvents(limit = 2000): SecurityEvent[] {
    return this.eventList.slice(0, limit);
  }

  private score(meter_id: string, now: number, window = 600): number {
    const recent = this.eventList.filter(
      e => e.meter_id === meter_id && e.ts >= now - window && e.action !== 'restored'
    );
    let penalty = 0;
    for (const e of recent) {
      if (e.severity === 'critical') penalty += 12;
      else if (e.severity === 'high') penalty += 10;
      else if (e.severity === 'medium') penalty += 4;
    }
    return Math.max(0, 100 - penalty);
  }

  private level(meter_id: string, now: number, window = 20): 'none' | 'medium' | 'high' {
    const recent = this.eventList.filter(
      e => e.meter_id === meter_id && e.ts >= now - window && (e.action === 'flagged' || e.action === 'rejected')
    );
    if (!recent.length) return 'none';
    const worst = Math.max(...recent.map(e => SEV_RANK[e.severity] || 0));
    return worst >= 3 ? 'high' : worst === 2 ? 'medium' : 'none';
  }

  public getMetersState(): Record<string, MeterInfo> {
    const now = Date.now() / 1000;
    const result: Record<string, MeterInfo> = {};

    for (const [mid, conf] of Object.entries(METERS_REGISTRY)) {
      const m = this.metersState.get(mid)!;
      const latestPoint = this.telemetryList.find(t => t.meter_id === mid) || null;

      const scr = this.score(mid, now);
      const lvl = this.level(mid, now, 20);

      let computedStatus: MeterInfo['status'] = m.status;
      if (m.status === 'online') {
        if (!latestPoint || now - latestPoint.ts > 12) {
          computedStatus = 'no_signal';
        } else if (lvl === 'high') {
          computedStatus = 'alert';
        } else if (lvl === 'medium') {
          computedStatus = 'warning';
        } else {
          computedStatus = 'online';
        }
      }

      result[mid] = {
        meter_id: mid,
        name: conf.name,
        site: conf.site,
        firmware: conf.firmware,
        status: computedStatus,
        last_seen: m.last_seen,
        last_seq: m.last_seq,
        energy_wh: m.energy_wh,
        accepted: m.accepted,
        rejected: m.rejected,
        blocked: m.blocked,
        isolated_reason: m.isolated_reason,
        data_source: this.isLive(mid) ? (this.liveSource.get(mid) || 'wokwi') : 'simulator',
        score: scr,
        level: lvl,
        latest: latestPoint
          ? {
              ts: latestPoint.ts,
              temp_c: latestPoint.temp_c,
              voltage_v: latestPoint.voltage_v,
              current_a: latestPoint.current_a,
              power_kw: latestPoint.power_kw,
              energy_wh: latestPoint.energy_wh,
              seq: latestPoint.seq,
            }
          : null,
      };
    }

    return result;
  }

  public getStats(): GridStats {
    const now = Date.now() / 1000;
    let isolatedCount = 0;
    let onlineCount = 0;

    for (const [mid, m] of this.metersState.entries()) {
      if (m.status === 'isolated') isolatedCount++;
      if (m.status === 'online' && m.last_seen && now - m.last_seen < 15) onlineCount++;
    }

    const threats = this.eventList.filter(e => e.action === 'flagged' || e.action === 'rejected').length;
    const recentThreats = this.eventList.filter(
      e => (e.action === 'flagged' || e.action === 'rejected') && e.ts >= now - 120
    );

    const worstSev = recentThreats.reduce((max, e) => Math.max(max, SEV_RANK[e.severity] || 0), 0);
    const threat: GridStats['threat'] = worstSev >= 3 ? 'ATTACK' : worstSev === 2 ? 'ELEVATED' : 'SECURE';

    // Grid load (kW)
    let load_kw = 0;
    const meterStates = this.getMetersState();
    for (const m of Object.values(meterStates)) {
      if (m.status !== 'isolated' && m.latest && now - m.latest.ts < 15) {
        load_kw += m.latest.power_kw;
      }
    }

    const serial_recent =
      this.telemetryList.filter(t => t.source === 'serial' && t.ts >= now - 15).length +
      this.eventList.filter(e => e.source === 'serial' && e.ts >= now - 15).length;

    const unauthorized_recent = Array.from(
      new Set(
        this.eventList
          .filter(e => e.type === 'unauthorized_device' && e.ts >= now - 30)
          .map(e => e.meter_id)
      )
    );

    return {
      accepted: this.counters.accepted || 0,
      rejected: this.counters.rejected || 0,
      blocked: this.counters.blocked || 0,
      threats,
      isolated: isolatedCount,
      online: onlineCount,
      threat,
      load_kw,
      serial_recent,
      unauthorized_recent,
    };
  }

  // Called when an external meter announces itself, so the simulator stops for that
  // meter immediately instead of racing the first real packet.
  public startHardwareSession(meter_id: string, source: string, addr = 'hardware'): boolean {
    const m = this.metersState.get(meter_id);
    if (!m || source !== 'arduino-live') return false;
    m.last_seq = 0;
    // Prevent simulator traffic from advancing the sequence before seq=1 arrives.
    this.claimLive(meter_id, 'arduino');
    this.logEvent(Date.now() / 1000, meter_id, 'info', 'hardware_session_sync',
      'Arduino hardware sequence state synchronized', source, 'accepted', '', addr);
    return true;
  }

  public claimLive(meter_id: string, source: 'arduino' | 'wokwi' = 'wokwi'): void {
    if (this.metersState.has(meter_id)) {
      this.liveLast.set(meter_id, Date.now() / 1000);
      this.liveSource.set(meter_id, source);
    }
  }

  public isLive(meter_id: string): boolean {
    const t = this.liveLast.get(meter_id);
    return t !== undefined && Date.now() / 1000 - t < GridGuardEngine.LIVE_TIMEOUT_S;
  }

  // Everything an external meter (via the Wokwi bridge) needs to line up with the gateway.
  public getSyncInfo(meter_id: string) {
    const m = this.metersState.get(meter_id);
    if (!m) return null;
    return {
      meter_id,
      epoch: Math.floor(Date.now() / 1000),
      last_seq: m.last_seq || 0,
      reported_wh: m.reported_wh ?? 0,
      status: m.status,
    };
  }

  public getLastRaw(meter_id: string): string | null {
    const pt = this.telemetryList.find(t => t.meter_id === meter_id);
    return pt ? pt.raw : null;
  }

  public getLastSeq(meter_id: string): number {
    const m = this.metersState.get(meter_id);
    return m ? m.last_seq : 0;
  }

  public getLastReportedWh(meter_id: string): number {
    const m = this.metersState.get(meter_id);
    return m && m.reported_wh !== null ? m.reported_wh : 0.0;
  }
}
