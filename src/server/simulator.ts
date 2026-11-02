import { GridGuardEngine, METERS_REGISTRY, signHmac } from './engine.js';
import {
  AttackResult,
  AttackResultItem,
  Verdict,
  MitmSimulationResult,
  MitmTamperedFieldDetail,
  MitmStatusStep,
  MitmDefenseCheck,
  MitmScenarioKey,
} from '../types.js';

interface Profile {
  cur: number;
  cur_amp: number;
  temp: number;
  phase: number;
}

const PROFILES: Record<string, Profile> = {
  'MTR-001': { cur: 1.25, cur_amp: 0.35, temp: 28.0, phase: 0.0 },
  'MTR-002': { cur: 1.70, cur_amp: 0.45, temp: 29.5, phase: 2.1 },
};

export const ATTACKS_CATALOG: Record<string, { title: string; desc: string; expect: string }> = {
  unauthorized: {
    title: 'Unauthorized Meter',
    desc: 'A rogue device (MTR-999) tries to inject telemetry.',
    expect: 'Rejected · critical alert',
  },
  invalid_hmac: {
    title: 'Tampered Message',
    desc: 'A valid packet is altered in transit (current edited) so its signature no longer matches.',
    expect: 'Rejected · HMAC mismatch',
  },
  replay: {
    title: 'Replay Attack',
    desc: 'An earlier genuine packet is captured and re-sent verbatim.',
    expect: 'Rejected · sequence already used',
  },
  tamper: {
    title: 'Compromised Meter',
    desc: 'A meter with a valid key starts reporting extreme values (burst of 3 packets).',
    expect: 'Flagged · auto-isolation',
  },
  energy_rollback: {
    title: 'Energy Rollback',
    desc: "A meter's cumulative energy register suddenly goes backwards (under-billing tamper).",
    expect: 'Flagged · energy rollback',
  },
  flood: {
    title: 'Message Flood',
    desc: 'A meter transmits far above its allowed rate (15 packets in a burst).',
    expect: 'Rate-limit alert',
  },
  normal: {
    title: 'Normal packet',
    desc: 'A correctly signed reading within limits, for comparison.',
    expect: 'Accepted, no alert',
  },
};

function randGaussian(mean = 0, stdev = 1): number {
  let u = 1 - Math.random();
  let v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdev;
}

export function formatPacket(
  meter_id: string,
  seq: number,
  temp: number,
  volt: number,
  cur: number,
  options?: {
    power?: number;
    alert?: boolean;
    key?: string | 'auto' | null;
    ts?: number;
    tamper_after_signing?: boolean;
    energy_wh?: number;
  }
): string {
  const power = options?.power !== undefined ? options.power : (volt * cur) / 1000.0;
  const alert = options?.alert ?? false;
  const ts = options?.ts !== undefined ? options.ts : Math.floor(Date.now() / 1000);

  const d: Record<string, unknown> = {
    meter_id,
    seq: String(seq),
    ts: String(ts),
    temp_c: temp.toFixed(1),
    voltage_v: volt.toFixed(1),
    current_a: cur.toFixed(2),
    power_kw: power.toFixed(2),
    alert,
  };

  if (options?.energy_wh !== undefined) {
    d.energy_wh = options.energy_wh.toFixed(2);
  }

  let signingKey: string | null = null;
  if (options?.key === undefined || options?.key === 'auto') {
    signingKey = METERS_REGISTRY[meter_id]?.key || null;
  } else {
    signingKey = options.key;
  }

  if (signingKey) {
    d.hmac = signHmac(d, signingKey);
  }

  if (options?.tamper_after_signing) {
    d.current_a = (Number(d.current_a) * 0.1).toFixed(2);
  }

  // Format JSON text exact syntax
  const parts: string[] = [];
  for (const [k, val] of Object.entries(d)) {
    if (k === 'meter_id' || k === 'hmac') {
      parts.push(`"${k}":"${val}"`);
    } else if (typeof val === 'boolean') {
      parts.push(`"${k}":${val ? 'true' : 'false'}`);
    } else {
      parts.push(`"${k}":${val}`);
    }
  }

  return '{' + parts.join(',') + '}';
}

export function healthyReading(meter_id: string, t?: number): [number, number, number] {
  const now = t ?? Date.now() / 1000;
  const p = PROFILES[meter_id] || PROFILES['MTR-001'];
  const cur = p.cur + p.cur_amp * Math.sin(now / 18 + p.phase) + randGaussian(0, 0.05);
  const volt = 230 + 2.2 * Math.sin(now / 31 + p.phase) + randGaussian(0, 0.5);
  const temp = p.temp + 1.6 * Math.sin(now / 47 + p.phase) + randGaussian(0, 0.15);
  return [temp, volt, Math.max(0.1, cur)];
}

export function normalPacket(engine: GridGuardEngine, meter_id: string): string {
  const [temp, volt, cur] = healthyReading(meter_id);
  const kwhStep = (volt * cur) / 1000.0 * 1000.0 * 2 / 3600.0;
  const energyWh = engine.getLastReportedWh(meter_id) + kwhStep;
  const seq = engine.getLastSeq(meter_id) + 1;
  return formatPacket(meter_id, seq, temp, volt, cur, { energy_wh: energyWh });
}

export function tickSimulator(engine: GridGuardEngine, minInterval = 1.8): Verdict[] {
  const now = Date.now() / 1000;
  const out: Verdict[] = [];
  for (const mid of Object.keys(METERS_REGISTRY)) {
    // A real (Wokwi) meter is sending for this ID: let it drive the data, simulator waits.
    if (engine.isLive(mid)) continue;
    const last = engine.simLast.get(mid) || 0;
    if (now - last >= minInterval) {
      engine.simLast.set(mid, now);
      const pkt = normalPacket(engine, mid);
      out.push(engine.ingest(pkt, 'simulator', `sim:${mid}`));
    }
  }
  return out;
}

export function runAttackScenario(engine: GridGuardEngine, kind: string, target = 'MTR-002'): AttackResult {
  const rows: AttackResultItem[] = [];

  const send = (desc: string, pkt: string, addr?: string) => {
    const packetAddr = addr || (['unauthorized', 'invalid_hmac', 'replay', 'flood'].includes(kind) ? 'lab-attacker' : `lab:${target}`);
    const verdict = engine.ingest(pkt, 'attack-lab', packetAddr);
    rows.push({ desc, verdict });
  };

  if (kind === 'unauthorized') {
    send(
      'Rogue device MTR-999 → telemetry',
      formatPacket('MTR-999', 1, 28.0, 230.0, 1.2, { key: 'attacker-guess' })
    );
  } else if (kind === 'invalid_hmac') {
    const [t, v, c] = healthyReading(target);
    send(
      `${target} packet edited after signing`,
      formatPacket(target, engine.getLastSeq(target) + 1, t, v, Math.max(c, 1.0), { tamper_after_signing: true })
    );
  } else if (kind === 'replay') {
    let raw = engine.getLastRaw(target);
    if (!raw) {
      send(`${target} genuine packet (captured)`, normalPacket(engine, target));
      raw = engine.getLastRaw(target)!;
    }
    send(`${target} captured packet re-sent verbatim`, raw);
  } else if (kind === 'tamper') {
    for (let i = 0; i < 3; i++) {
      const seq = engine.getLastSeq(target) + 1;
      const power = i === 2 ? 6.0 : undefined;
      send(
        `${target} extreme reading #${i + 1}`,
        formatPacket(target, seq, 78.0 + i, 262.0, 14.5, { power })
      );
    }
  } else if (kind === 'flood') {
    const burst: Verdict[] = [];
    for (let i = 0; i < 15; i++) {
      const [t, v, c] = healthyReading(target);
      burst.push(
        engine.ingest(
          formatPacket(target, engine.getLastSeq(target) + 1, t, v, c),
          'attack-lab',
          'lab-attacker'
        )
      );
    }
    const ok = burst.filter(b => b.accepted);
    const bad = burst.filter(b => !b.accepted);
    if (ok.length) {
      rows.push({ desc: `${ok.length} burst packets accepted before the limit was hit`, verdict: ok[ok.length - 1] });
    }
    if (bad.length) {
      rows.push({ desc: 'First packet over the limit', verdict: bad[0] });
      rows.push({ desc: `${bad.length} packets dropped in total`, verdict: bad[bad.length - 1] });
    }
  } else if (kind === 'energy_rollback') {
    send(`${target} normal reading (energy register counting up)`, normalPacket(engine, target));
    const prev = engine.getLastReportedWh(target);
    const [t, v, c] = healthyReading(target);
    send(
      `${target} reports energy ${(prev * 0.2).toFixed(2)} Wh after ${prev.toFixed(2)} Wh`,
      formatPacket(target, engine.getLastSeq(target) + 1, t, v, c, { energy_wh: prev * 0.2 })
    );
  } else if (kind === 'normal') {
    send(`${target} healthy packet`, normalPacket(engine, target));
  } else {
    throw new Error(`Unknown attack kind: ${kind}`);
  }

  const title = ATTACKS_CATALOG[kind]?.title || 'Normal packet';
  return { title, target, rows };
}

export function runMitmSimulation(
  engine: GridGuardEngine,
  mode: 'attack' | 'defense',
  target = 'MTR-002',
  scenarioKey: string = 'current_power'
): MitmSimulationResult {
  let key: MitmScenarioKey = 'current_power';
  if (scenarioKey === 'normal') key = 'normal';
  else if (scenarioKey === 'current_power') key = 'current_power';
  else if (scenarioKey === 'energy_rollback') key = 'energy_rollback';
  else if (scenarioKey === 'stale_timestamp') key = 'stale_timestamp';
  else if (scenarioKey === 'seq_replay') key = 'seq_replay';
  else if (scenarioKey === 'historical_spike' || scenarioKey === 'historical_pattern') key = 'historical_spike';

  const [origTemp, origVolt, origCur] = healthyReading(target);
  const origPower = Number(((origVolt * origCur) / 1000.0).toFixed(2));
  const seq = engine.getLastSeq(target) + 1;
  const nowTs = Math.floor(Date.now() / 1000);
  const kwhStep = (origVolt * origCur / 1000.0 * 1000.0 * 2) / 3600.0;
  const origEnergyWh = Number((engine.getLastReportedWh(target) + kwhStep).toFixed(2));

  // 1. Build original legitimate packet signed by genuine meter key
  const originalRaw = formatPacket(target, seq, origTemp, origVolt, origCur, {
    power: origPower,
    energy_wh: origEnergyWh,
    ts: nowTs,
    alert: false,
    key: 'auto',
  });
  const originalPacket = JSON.parse(originalRaw);

  const modifiedPacket: Record<string, any> = { ...originalPacket };
  const tamperedFields: string[] = [];
  const tamperedFieldDetails: MitmTamperedFieldDetail[] = [];
  const statusSteps: MitmStatusStep[] = [];
  const defenseEvaluation: MitmDefenseCheck[] = [];

  let scenarioTitle = '';
  let hmacStatus = '';
  let primaryDefenseLayer = '';
  let defenseReason = '';
  let verdictSummary = '';
  let seqDetails: { previousAcceptedSeq: number; receivedSeq: number; reason: string } | undefined = undefined;

  if (key === 'normal') {
    // 1. No Interception / Normal Packet
    scenarioTitle = 'No Interception / Normal Packet';
    hmacStatus = 'Valid (Authentic meter signature)';
    primaryDefenseLayer = 'None — all checks passed';
    defenseReason =
      'Legitimate direct transmission from the smart meter. All cryptographic, chronological, electrical, and behavioral checks passed without exception.';
    verdictSummary = 'No interception detected. Packet accepted.';

    statusSteps.push(
      {
        step: 1,
        title: 'Packet Emitted by Meter',
        description: `Legitimate telemetry packet emitted and signed by ${target} (Seq #${seq}, ${origVolt.toFixed(1)}V, ${origCur.toFixed(2)}A, ${origPower.toFixed(2)}kW).`,
        status: 'info',
      },
      {
        step: 2,
        title: 'Direct Transmission Channel',
        description: 'Packet transmitted directly across secure channel without intermediary interception.',
        status: 'info',
      },
      {
        step: 3,
        title: 'Gateway Ingested & Verified',
        description: 'GridGuard gateway successfully verified authentic HMAC, sequence monotonicity, and valid physical limits.',
        status: 'success',
      }
    );

    defenseEvaluation.push(
      {
        checkName: '1. HMAC-SHA256 Cryptographic Signature',
        passed: true,
        severity: 'critical',
        detail: 'HMAC signature matches canonical payload computed with shared secret key.',
        result: 'Passed',
        reason: 'Signature matches canonical payload.',
        classification: 'passed',
      },
      {
        checkName: '2. Freshness & Replay Protection: Timestamp',
        passed: true,
        severity: 'high',
        detail: 'Timestamp delta is 0s (well within 30s allowable skew).',
        result: 'Passed',
        reason: 'Timestamp within allowable 30s window.',
        classification: 'passed',
      },
      {
        checkName: '3. Freshness & Replay Protection: Sequence Number',
        passed: true,
        severity: 'high',
        detail: `Sequence #${seq} is strictly monotonic (last accepted: ${seq - 1}).`,
        result: 'Passed',
        reason: 'Sequence number is valid.',
        classification: 'passed',
      },
      {
        checkName: '4. Physical Telemetry Consistency',
        passed: true,
        severity: 'high',
        detail: 'Active power conforms to V × I apparent power; cumulative energy register incremented normally.',
        result: 'Passed',
        reason: 'Voltage, current and power are physically aligned.',
        classification: 'passed',
      },
      {
        checkName: '5. Physical Operating Threshold Bands',
        passed: true,
        severity: 'info',
        detail: `Voltage ${origVolt.toFixed(1)}V, Current ${origCur.toFixed(2)}A, Temp ${origTemp.toFixed(1)}°C all within safe bands.`,
        result: 'Passed',
        reason: 'Within standard operating thresholds.',
        classification: 'passed',
      },
      {
        checkName: '6. Historical Pattern & Behavior Analysis',
        passed: true,
        severity: 'medium',
        detail: `Active power ${origPower.toFixed(2)} kW is consistent with recent rolling average.`,
        result: 'Passed',
        reason: 'Metric deltas within normal baseline.',
        classification: 'passed',
      }
    );
  } else if (key === 'current_power') {
    // 2. Current & Power Forgery
    scenarioTitle = 'Current & Power Forgery';
    const newCurrent = 9.4;
    const newPower = Number(((origVolt * newCurrent) / 1000.0).toFixed(2));
    modifiedPacket.current_a = newCurrent.toFixed(2);
    modifiedPacket.power_kw = newPower.toFixed(2);
    tamperedFields.push('current_a', 'power_kw');

    tamperedFieldDetails.push(
      {
        field: 'current_a',
        originalValue: originalPacket.current_a,
        modifiedValue: modifiedPacket.current_a,
        unit: 'A',
        reason: `Current escalated from ${originalPacket.current_a} A to ${modifiedPacket.current_a} A to spoof heavy load condition`,
      },
      {
        field: 'power_kw',
        originalValue: originalPacket.power_kw,
        modifiedValue: modifiedPacket.power_kw,
        unit: 'kW',
        reason: `Active power recalculated and forged to ${modifiedPacket.power_kw} kW`,
      }
    );

    hmacStatus = 'Mismatched (Packet modified after signing)';
    primaryDefenseLayer = 'HMAC-SHA256 Cryptographic Signature';
    defenseReason =
      'Cryptographic hash covers current_a and power_kw. Modifying payload values without the pre-shared secret key produces an immediate signature mismatch at the transport boundary.';
    verdictSummary = 'Tampered packet rejected: HMAC signature mismatch.';

    statusSteps.push(
      {
        step: 1,
        title: 'Packet Intercepted',
        description: `Legitimate telemetry packet emitted by ${target} was intercepted in-transit by the software MITM proxy.`,
        status: 'info',
      },
      {
        step: 2,
        title: 'Message Tampered',
        description: `Interceptor modified current_a (${newCurrent} A) and power_kw (${newPower} kW) in-memory without possessing ${target}'s secret cryptographic key.`,
        status: 'warning',
      },
      {
        step: 3,
        title: 'Modified Packet Forwarded to Gateway',
        description: 'Tampered payload containing forged measurements was transmitted downstream to the GridGuard gateway.',
        status: 'danger',
      }
    );

    defenseEvaluation.push(
      {
        checkName: '1. HMAC-SHA256 Cryptographic Signature',
        passed: false,
        severity: 'critical',
        detail: 'HMAC verification failed: packet was modified after signing.',
        result: 'Failed',
        reason: 'Packet modified after signing.',
        classification: 'rejected',
      },
      {
        checkName: '2. Freshness & Replay Protection: Timestamp',
        passed: true,
        severity: 'high',
        detail: 'Packet timestamp is fresh (within 30s allowable skew).',
        result: 'Passed',
        reason: 'Timestamp within allowable skew.',
        classification: 'passed',
      },
      {
        checkName: '3. Freshness & Replay Protection: Sequence Number',
        passed: true,
        severity: 'high',
        detail: `Sequence #${seq} strictly monotonic.`,
        result: 'Passed',
        reason: 'Sequence number is valid.',
        classification: 'passed',
      },
      {
        checkName: '4. Physical Telemetry Consistency',
        passed: true,
        severity: 'high',
        detail: 'Mathematical consistency check evaluated against apparent power law.',
        result: 'Passed',
        reason: 'Voltage, current and power are physically aligned.',
        classification: 'passed',
      },
      {
        checkName: '5. Physical Operating Threshold Bands',
        passed: false,
        severity: 'medium',
        detail: `Forged current (${newCurrent.toFixed(2)} A) and power (${newPower.toFixed(2)} kW) exceed nominal operational threshold bands (cur_crit: 8.0 A, pow_crit: 1.8 kW).`,
        result: 'Warning',
        reason: 'Elevated above nominal utility band.',
        classification: 'warning',
      },
      {
        checkName: '6. Historical Pattern & Behavior Analysis',
        passed: true,
        severity: 'medium',
        detail: 'Baseline rolling consumption pattern checked.',
        result: 'Passed',
        reason: 'Metric deltas within normal baseline.',
        classification: 'passed',
      }
    );
  } else if (key === 'energy_rollback') {
    // 3. Energy Rollback Forgery
    scenarioTitle = 'Energy Rollback Forgery';
    const newEnergy = Math.max(0.1, Number((origEnergyWh * 0.25).toFixed(2)));
    modifiedPacket.energy_wh = newEnergy.toFixed(2);
    tamperedFields.push('energy_wh');

    tamperedFieldDetails.push({
      field: 'energy_wh',
      originalValue: originalPacket.energy_wh,
      modifiedValue: modifiedPacket.energy_wh,
      unit: 'Wh',
      reason: `Cumulative energy reduced by 75% (${originalPacket.energy_wh} Wh -> ${modifiedPacket.energy_wh} Wh) for theft simulation`,
    });

    hmacStatus = 'Mismatched (Packet modified after signing)';
    primaryDefenseLayer = 'HMAC-SHA256 Cryptographic Signature';
    defenseReason =
      'The interceptor modified energy_wh without the secret key, triggering immediate HMAC rejection. Even if HMAC were bypassed, the gateway\'s monotonicity rule prohibits cumulative Wh from rolling back.';
    verdictSummary = 'Tampered packet rejected: HMAC signature mismatch. Energy rollback would also be flagged.';

    statusSteps.push(
      {
        step: 1,
        title: 'Packet Intercepted',
        description: `Legitimate telemetry packet emitted by ${target} was intercepted in-transit by the software MITM proxy.`,
        status: 'info',
      },
      {
        step: 2,
        title: 'Message Tampered',
        description: `Interceptor reduced cumulative energy_wh from ${origEnergyWh} Wh to ${newEnergy} Wh without recomputing HMAC.`,
        status: 'warning',
      },
      {
        step: 3,
        title: 'Modified Packet Forwarded to Gateway',
        description: 'Forged energy rollback packet transmitted downstream to the GridGuard gateway.',
        status: 'danger',
      }
    );

    defenseEvaluation.push(
      {
        checkName: '1. HMAC-SHA256 Cryptographic Signature',
        passed: false,
        severity: 'critical',
        detail: 'HMAC verification failed: packet was modified after signing.',
        result: 'Failed',
        reason: 'Packet modified after signing.',
        classification: 'rejected',
      },
      {
        checkName: '2. Freshness & Replay Protection: Timestamp',
        passed: true,
        severity: 'high',
        detail: 'Timestamp is within allowable 30s window.',
        result: 'Passed',
        reason: 'Timestamp within allowable skew.',
        classification: 'passed',
      },
      {
        checkName: '3. Freshness & Replay Protection: Sequence Number',
        passed: true,
        severity: 'high',
        detail: `Sequence #${seq} is strictly monotonic.`,
        result: 'Passed',
        reason: 'Sequence number is valid.',
        classification: 'passed',
      },
      {
        checkName: '4. Physical Telemetry Consistency',
        passed: false,
        severity: 'high',
        detail: `Cumulative energy fell from ${origEnergyWh} Wh to ${newEnergy} Wh. Energy rollback rule detected.`,
        result: 'Failed',
        reason: 'Energy rollback detected (cumulative Wh decreased).',
        classification: 'rejected',
      },
      {
        checkName: '5. Physical Operating Threshold Bands',
        passed: true,
        severity: 'info',
        detail: 'Voltage, current, and temperature within standard utility limits.',
        result: 'Passed',
        reason: 'Within standard operating thresholds.',
        classification: 'passed',
      },
      {
        checkName: '6. Historical Pattern & Behavior Analysis',
        passed: true,
        severity: 'medium',
        detail: 'Instantaneous load values align with historical baseline.',
        result: 'Passed',
        reason: 'Metric deltas within normal baseline.',
        classification: 'passed',
      }
    );
  } else if (key === 'stale_timestamp') {
    // 4. Timestamp Tampering / Replay Injection
    scenarioTitle = 'Timestamp Tampering / Replay Injection';
    const staleTs = nowTs - 180; // 3 minutes in the past
    modifiedPacket.ts = String(staleTs);
    tamperedFields.push('ts');

    tamperedFieldDetails.push({
      field: 'ts',
      originalValue: originalPacket.ts,
      modifiedValue: modifiedPacket.ts,
      unit: 'epoch',
      reason: 'Timestamp rolled back by 180 seconds to test replay/freshness defense',
    });

    // The interceptor modifies ts without possessing the meter secret key, keeping original signature
    hmacStatus = 'Mismatched (Packet modified after signing)';
    primaryDefenseLayer = 'HMAC-SHA256 Cryptographic Signature';
    defenseReason =
      'Timestamp tampering invalidates the canonical HMAC payload. Modifying the timestamp without possessing the secret cryptographic key causes an immediate signature failure at the gateway transport boundary. In addition, the gateway clock skew check independently flags the timestamp as 180 seconds stale.';
    verdictSummary = 'Tampered packet rejected: HMAC signature mismatch.';

    statusSteps.push(
      {
        step: 1,
        title: 'Packet Intercepted',
        description: `Legitimate telemetry packet emitted by ${target} was intercepted in-transit by the software MITM proxy.`,
        status: 'info',
      },
      {
        step: 2,
        title: 'Message Tampered',
        description: `Interceptor modified packet timestamp to an old value (${staleTs}, 180s in past) without updating HMAC.`,
        status: 'warning',
      },
      {
        step: 3,
        title: 'Modified Packet Forwarded to Gateway',
        description: 'Stale injected payload transmitted downstream to the GridGuard gateway.',
        status: 'danger',
      }
    );

    defenseEvaluation.push(
      {
        checkName: '1. HMAC-SHA256 Cryptographic Signature',
        passed: false,
        severity: 'critical',
        detail: 'HMAC verification failed: packet was modified after signing.',
        result: 'Failed',
        reason: 'Packet modified after signing.',
        classification: 'rejected',
      },
      {
        checkName: '2. Freshness & Replay Protection: Timestamp',
        passed: false,
        severity: 'high',
        detail: 'Packet timestamp is 180s in the past (exceeds 30s limit). Clock skew threshold exceeded.',
        result: 'Failed',
        reason: 'Timestamp is 180 seconds stale.',
        classification: 'rejected',
      },
      {
        checkName: '3. Freshness & Replay Protection: Sequence Number',
        passed: true,
        severity: 'high',
        detail: `Sequence #${seq} is monotonic.`,
        result: 'Passed',
        reason: 'Sequence number is valid.',
        classification: 'passed',
      },
      {
        checkName: '4. Physical Telemetry Consistency',
        passed: true,
        severity: 'high',
        detail: 'Voltage, current, and active power conform to physical laws.',
        result: 'Passed',
        reason: 'Voltage, current and power are physically aligned.',
        classification: 'passed',
      },
      {
        checkName: '5. Physical Operating Threshold Bands',
        passed: true,
        severity: 'info',
        detail: 'Analog telemetry within normal equipment operating bands.',
        result: 'Passed',
        reason: 'Within standard operating thresholds.',
        classification: 'passed',
      },
      {
        checkName: '6. Historical Pattern & Behavior Analysis',
        passed: true,
        severity: 'medium',
        detail: 'Telemetry matches rolling historical average.',
        result: 'Passed',
        reason: 'Metric deltas within normal baseline.',
        classification: 'passed',
      }
    );
  } else if (key === 'seq_replay') {
    // 5. Sequence Number Replay
    scenarioTitle = 'Sequence Number Replay';
    const lastSeq = Math.max(1, engine.getLastSeq(target));
    const replayedSeq = Math.max(1, lastSeq - 2);
    modifiedPacket.seq = replayedSeq;
    tamperedFields.push('seq');

    tamperedFieldDetails.push({
      field: 'seq',
      originalValue: originalPacket.seq,
      modifiedValue: replayedSeq,
      unit: 'count',
      reason: `Sequence number reused from previously accepted transmission (${replayedSeq} <= last accepted ${lastSeq}) to execute replay attack`,
    });

    // Recompute valid HMAC for the replayed packet so that HMAC check PASSES, allowing Replay Protection to be primary defense!
    modifiedPacket.hmac = signHmac(modifiedPacket, METERS_REGISTRY[target].key);
    hmacStatus = 'Valid for replayed payload (authentic captured signature)';
    primaryDefenseLayer = 'Freshness & Replay Protection: Sequence Number';
    defenseReason =
      'In a replay attack, the adversary re-transmits an authentic, correctly signed packet from earlier. Because the signature is valid, cryptographic checks pass, but the monotonic sequence counter catches the duplicate sequence number.';
    verdictSummary = 'Replay detected: sequence number has already been used.';

    seqDetails = {
      previousAcceptedSeq: lastSeq,
      receivedSeq: replayedSeq,
      reason: `Sequence number ${replayedSeq} has already been used (last accepted was ${lastSeq}). Monotonic sequence check strictly blocks replayed frames.`,
    };

    statusSteps.push(
      {
        step: 1,
        title: 'Packet Intercepted & Captured',
        description: `Interceptor captured authentic packet transmission previously emitted by ${target}.`,
        status: 'info',
      },
      {
        step: 2,
        title: 'Old Sequence Re-injected',
        description: `Adversary re-injected old frame with sequence number #${replayedSeq} (already accepted previously: #${lastSeq}) while carrying a valid HMAC signature.`,
        status: 'warning',
      },
      {
        step: 3,
        title: 'Replay Packet Forwarded to Gateway',
        description: 'Replayed frame forwarded to gateway socket.',
        status: 'danger',
      }
    );

    defenseEvaluation.push(
      {
        checkName: '1. HMAC-SHA256 Cryptographic Signature',
        passed: true,
        severity: 'critical',
        detail: 'HMAC verification passed: cryptographic signature matches replayed payload.',
        result: 'Passed',
        reason: 'Valid captured HMAC.',
        classification: 'passed',
      },
      {
        checkName: '2. Freshness & Replay Protection: Timestamp',
        passed: true,
        severity: 'high',
        detail: 'Packet timestamp is within allowable skew window.',
        result: 'Passed',
        reason: 'Timestamp within allowed skew.',
        classification: 'passed',
      },
      {
        checkName: '3. Freshness & Replay Protection: Sequence Number',
        passed: false,
        severity: 'high',
        detail: `Replay detected: sequence number ${replayedSeq} has already been used (last accepted was ${lastSeq}).`,
        result: 'Failed',
        reason: 'Sequence number already used.',
        classification: 'rejected',
      },
      {
        checkName: '4. Physical Telemetry Consistency',
        passed: true,
        severity: 'high',
        detail: 'Power, voltage, and current mathematically consistent.',
        result: 'Passed',
        reason: 'Voltage, current and power are physically aligned.',
        classification: 'passed',
      },
      {
        checkName: '5. Physical Operating Threshold Bands',
        passed: true,
        severity: 'info',
        detail: 'Measurements within safe operating thresholds.',
        result: 'Passed',
        reason: 'Within standard operating thresholds.',
        classification: 'passed',
      },
      {
        checkName: '6. Historical Pattern & Behavior Analysis',
        passed: true,
        severity: 'medium',
        detail: 'Telemetry consistent with normal operation.',
        result: 'Passed',
        reason: 'Metric deltas within normal baseline.',
        classification: 'passed',
      }
    );
  } else {
    // 6. Historical Spike Tampering
    scenarioTitle = 'Historical Spike Tampering';
    // Ensure sufficient baseline history in engine so sudden spike detector triggers
    const telemetry = engine.getTelemetry();
    const targetPowers = telemetry.filter(t => t.meter_id === target && !t.flagged).map(t => t.power_kw);
    if (targetPowers.length < 5) {
      for (let i = 0; i < 5; i++) {
        const [st, sv, sc] = healthyReading(target);
        const spw = Number(((sv * sc) / 1000.0).toFixed(2));
        const swh = Number((engine.getLastReportedWh(target) + 0.05).toFixed(2));
        const sseq = engine.getLastSeq(target) + 1;
        const spkt = formatPacket(target, sseq, st, sv, sc, {
          power: spw,
          energy_wh: swh,
          ts: nowTs - (12 - i * 2),
          alert: false,
          key: 'auto',
        });
        engine.ingest(spkt, 'serial', `sim:${target}`);
      }
    }

    const updatedTelemetry = engine.getTelemetry();
    const updatedPowers = updatedTelemetry.filter(t => t.meter_id === target && !t.flagged).map(t => t.power_kw);
    const mean =
      updatedPowers.length > 0
        ? updatedPowers.slice(0, 10).reduce((a, b) => a + b, 0) / Math.min(10, updatedPowers.length)
        : origPower;

    const freshSeq = engine.getLastSeq(target) + 1;
    modifiedPacket.seq = freshSeq;
    originalPacket.seq = freshSeq;

    const spikedPower = Number((mean * 2.8).toFixed(2));
    const spikedCurrent = Number(((spikedPower * 1000) / origVolt).toFixed(2));

    modifiedPacket.power_kw = spikedPower.toFixed(2);
    modifiedPacket.current_a = spikedCurrent.toFixed(2);
    tamperedFields.push('power_kw', 'current_a');

    tamperedFieldDetails.push(
      {
        field: 'power_kw',
        originalValue: originalPacket.power_kw,
        modifiedValue: modifiedPacket.power_kw,
        unit: 'kW',
        reason: `Power artificially increased to ${modifiedPacket.power_kw} kW (2.8x historical mean ${mean.toFixed(2)} kW) to simulate behavioral surge`,
      },
      {
        field: 'current_a',
        originalValue: originalPacket.current_a,
        modifiedValue: modifiedPacket.current_a,
        unit: 'A',
        reason: `Current proportionally adjusted to ${modifiedPacket.current_a} A to preserve V × I physical law`,
      }
    );

    // Recompute HMAC so HMAC check PASSES!
    modifiedPacket.hmac = signHmac(modifiedPacket, METERS_REGISTRY[target].key);
    hmacStatus = 'Valid cryptographic signature (Recomputed by attacker)';
    primaryDefenseLayer = 'Historical Pattern & Behavior Analysis';
    defenseReason =
      'Even if a rogue packet is cryptographically authenticated with a valid key and satisfies physical sensor ranges, the gateway\'s statistical behavioral filter identifies unexpected deviation from historical consumption patterns.';
    verdictSummary = 'Warning: sudden power spike detected. Historical pattern flagged as anomaly (not confirmed attack).';

    statusSteps.push(
      {
        step: 1,
        title: 'Packet Intercepted',
        description: `Legitimate telemetry packet emitted by ${target} was intercepted in-transit by the software MITM proxy.`,
        status: 'info',
      },
      {
        step: 2,
        title: 'Surge Injected & Signed',
        description: `Interceptor injected sudden power surge (2.8x historical mean) and recomputed a valid cryptographic signature.`,
        status: 'warning',
      },
      {
        step: 3,
        title: 'Signed Packet Forwarded to Gateway',
        description: 'Cryptographically valid frame carrying sudden power spike forwarded to gateway socket.',
        status: 'danger',
      }
    );

    defenseEvaluation.push(
      {
        checkName: '1. HMAC-SHA256 Cryptographic Signature',
        passed: true,
        severity: 'critical',
        detail: 'HMAC verification passed: cryptographic signature is valid.',
        result: 'Passed',
        reason: 'Valid cryptographic signature.',
        classification: 'passed',
      },
      {
        checkName: '2. Freshness & Replay Protection: Timestamp',
        passed: true,
        severity: 'high',
        detail: 'Timestamp is current (within 30s window).',
        result: 'Passed',
        reason: 'Timestamp within allowed skew.',
        classification: 'passed',
      },
      {
        checkName: '3. Freshness & Replay Protection: Sequence Number',
        passed: true,
        severity: 'high',
        detail: `Sequence #${seq} is strictly monotonic.`,
        result: 'Passed',
        reason: 'Sequence number is valid.',
        classification: 'passed',
      },
      {
        checkName: '4. Physical Telemetry Consistency',
        passed: true,
        severity: 'high',
        detail: `Reported power ${spikedPower.toFixed(2)} kW matches V × I apparent power (${origVolt.toFixed(0)}V × ${spikedCurrent.toFixed(2)}A = ${(origVolt * spikedCurrent / 1000).toFixed(2)} kW).`,
        result: 'Passed',
        reason: 'Voltage, current and power are physically aligned.',
        classification: 'passed',
      },
      {
        checkName: '5. Physical Operating Threshold Bands',
        passed: true,
        severity: 'info',
        detail: `Readings remain within physical equipment limits (< 1.80 kW limit).`,
        result: 'Passed',
        reason: 'Within standard operating thresholds.',
        classification: 'passed',
      },
      {
        checkName: '6. Historical Pattern & Behavior Analysis',
        passed: false,
        severity: 'medium',
        detail: `Warning: sudden power spike detected (${spikedPower.toFixed(2)} kW vs recent mean ${mean.toFixed(2)} kW). Reading differs from recent normal pattern.`,
        result: 'Warning',
        reason: 'Warning: sudden power spike detected.',
        classification: 'warning',
      }
    );
  }

  // Format modified JSON text preserving unquoted numbers
  const parts: string[] = [];
  for (const [k, val] of Object.entries(modifiedPacket)) {
    if (k === 'meter_id' || k === 'hmac') {
      parts.push(`"${k}":"${val}"`);
    } else if (typeof val === 'boolean') {
      parts.push(`"${k}":${val ? 'true' : 'false'}`);
    } else {
      parts.push(`"${k}":${val}`);
    }
  }
  const modifiedRaw = '{' + parts.join(',') + '}';

  // Process packet through the gateway engine
  const ingestSource = 'mitm-interceptor';
  const verdict = engine.ingest(key === 'normal' ? originalRaw : modifiedRaw, ingestSource, `mitm:${target}`);

  const primaryDefenseFailed = primaryDefenseLayer;

  const realWorldImpact =
    key === 'normal'
      ? 'Standard operational telemetry stream flowing without disruption. Substation SCADA state estimator incorporates live measurements to maintain distribution grid equilibrium.'
      : key === 'seq_replay'
      ? 'Replay protection blocks stale telemetry injection that could trick grid operators into thinking obsolete load profiles are currently active, preventing incorrect capacitor bank switching.'
      : key === 'historical_spike'
      ? 'Behavioral anomaly monitoring alerts substation engineers to unprecedented consumption surges before physical conductors overheat, distinguishing legitimate demand shifts from subtle compromised meter actions.'
      : mode === 'defense'
      ? 'In an operational substation, the multi-layered defense pipeline immediately catches this unauthorized modification before corrupt values reach SCADA state estimation, avoiding false feeder re-dispatch.'
      : 'If an adversary successfully tampers with metering data without layered defense, grid operators would observe falsified load levels, potentially causing automated generator throttling or billing fraud.';

  return {
    mode,
    target,
    scenarioKey: key,
    scenarioTitle,
    originalPacket,
    originalRaw,
    modifiedPacket,
    modifiedRaw,
    tamperedFields,
    tamperedFieldDetails,
    hmacStatus,
    primaryDefenseLayer,
    defenseReason,
    statusSteps,
    defenseEvaluation,
    primaryDefenseFailed,
    verdict,
    verdictSummary,
    realWorldImpact,
    seqDetails,
  };
}

