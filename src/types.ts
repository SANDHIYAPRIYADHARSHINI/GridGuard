export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  severity: Severity;
  type: string;
  reason: string;
}

export interface Verdict {
  raw: string;
  meter_id: string | null;
  accepted: boolean;
  blocked: boolean;
  authenticated: boolean | null;
  isolated_now: boolean;
  findings: Finding[];
  severity: Severity;
  label: 'ACCEPTED' | 'FLAGGED' | 'REJECTED' | 'BLOCKED';
}

export interface TelemetryPoint {
  id: number;
  ts: number;
  timeStr: string;
  meter_id: string;
  temp_c: number;
  voltage_v: number;
  current_a: number;
  power_kw: number;
  energy_wh: number;
  seq: number | null;
  flagged: boolean;
  raw: string;
  reported_wh: number | null;
  source: string;
}

export interface SecurityEvent {
  id: number;
  ts: number;
  timeStr: string;
  meter_id: string;
  severity: Severity;
  type: string;
  reason: string;
  source: string;
  action: 'accepted' | 'flagged' | 'rejected' | 'isolated' | 'restored' | 'blocked';
  raw: string;
  addr: string;
  meter_state: string;
}

export interface MeterInfo {
  meter_id: string;
  name: string;
  site: string;
  firmware: string;
  status: 'online' | 'isolated' | 'warning' | 'alert' | 'no_signal';
  last_seen: number | null;
  last_seq: number;
  energy_wh: number;
  accepted: number;
  rejected: number;
  blocked: number;
  isolated_reason: string | null;
  data_source: 'wokwi' | 'arduino' | 'simulator';
  score: number;
  level: 'none' | 'medium' | 'high';
  latest: {
    ts: number;
    temp_c: number;
    voltage_v: number;
    current_a: number;
    power_kw: number;
    energy_wh: number;
    seq: number | null;
  } | null;
}

export interface GridStats {
  accepted: number;
  rejected: number;
  blocked: number;
  threats: number;
  isolated: number;
  online: number;
  threat: 'SECURE' | 'ELEVATED' | 'ATTACK';
  load_kw: number;
  serial_recent: number;
  unauthorized_recent: string[];
}

export interface AttackResultItem {
  desc: string;
  verdict: Verdict;
}

export interface AttackResult {
  title: string;
  target: string;
  rows: AttackResultItem[];
}

export interface GatewaySettings {
  auto_isolate: boolean;
  strict_hmac: boolean;
  sim_on: boolean;
  auto_refresh: boolean;
  refresh_interval: number;
  live_mitm_on: boolean;
  live_mitm_mode: string;
  live_mitm_rate: number;
}

export interface LiveMitmStatus {
  enabled: boolean;
  mode: string;
  rate: number;
  intercepted: number;
  attacked: number;
  by_attack: Record<string, number>;
  caught: number;
  missed: number;
  last: { time: string; meter_id: string; attack: string; label: string } | null;
  pending_strike: { attack: string; meter: string | null } | null;
  log: LiveMitmLogEntry[];
  attacks: { key: string; label: string; summary: string; signature: string }[];
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

export type MitmScenarioKey =
  | 'normal'
  | 'current_power'
  | 'energy_rollback'
  | 'stale_timestamp'
  | 'seq_replay'
  | 'historical_spike';

export interface MitmTamperedFieldDetail {
  field: string;
  originalValue: string | number;
  modifiedValue: string | number;
  unit: string;
  reason: string;
}

export interface MitmStatusStep {
  step: number;
  title: string;
  description: string;
  status: 'success' | 'warning' | 'danger' | 'info';
}

export interface MitmDefenseCheck {
  checkName: string;
  passed: boolean;
  severity: 'critical' | 'high' | 'medium' | 'info';
  detail: string; // Gateway finding
  result: 'Passed' | 'Failed' | 'Warning';
  reason: string; // Short reason
  classification: 'rejected' | 'flagged' | 'warning' | 'passed';
}

export interface MitmSimulationResult {
  mode: 'attack' | 'defense';
  target: string;
  scenarioKey: MitmScenarioKey;
  scenarioTitle: string;
  originalPacket: Record<string, any>;
  originalRaw: string;
  modifiedPacket: Record<string, any>;
  modifiedRaw: string;
  tamperedFields: string[];
  tamperedFieldDetails: MitmTamperedFieldDetail[];
  hmacStatus: string;
  primaryDefenseLayer: string;
  defenseReason: string;
  statusSteps: MitmStatusStep[];
  defenseEvaluation: MitmDefenseCheck[];
  primaryDefenseFailed: string;
  verdict: Verdict;
  verdictSummary: string;
  realWorldImpact: string;
  seqDetails?: {
    previousAcceptedSeq: number;
    receivedSeq: number;
    reason: string;
  };
}

