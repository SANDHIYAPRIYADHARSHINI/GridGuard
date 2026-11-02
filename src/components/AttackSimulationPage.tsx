import React, { useState, useEffect } from 'react';
import {
  MeterInfo,
  Verdict,
  MitmSimulationResult,
  MitmTamperedFieldDetail,
  MitmDefenseCheck,
  MitmScenarioKey,
} from '../types.js';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Play,
  Send,
  ArrowRight,
  Info,
  ChevronDown,
  ChevronUp,
  Cpu,
  Server,
  Radio,
  FileCode,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Zap,
  Clock,
  RotateCcw,
  Activity,
  Database,
} from 'lucide-react';

interface AttackSimulationPageProps {
  meters: Record<string, MeterInfo>;
  onRunMitm: (
    mode: 'attack' | 'defense',
    target: string,
    scenarioKey: MitmScenarioKey
  ) => Promise<MitmSimulationResult>;
  onIngestPacket: (rawJson: string) => Promise<Verdict>;
  mitmResult: MitmSimulationResult | null;
}

const SCENARIOS: {
  key: MitmScenarioKey;
  label: string;
  badge: string;
  shortDesc: string;
  expectedDefense: string;
}[] = [
  {
    key: 'normal',
    label: '1. No Interception / Normal Packet',
    badge: 'Baseline Clean',
    shortDesc: 'Meter sends genuine reading directly to gateway. No interceptor tampering.',
    expectedDefense: 'All Passed → ACCEPTED',
  },
  {
    key: 'current_power',
    label: '2. Current & Power Forgery',
    badge: 'HMAC Failure',
    shortDesc: 'Current escalated to 9.4A & power to 2.16kW; original HMAC signature unchanged.',
    expectedDefense: 'HMAC Mismatch → REJECTED',
  },
  {
    key: 'energy_rollback',
    label: '3. Energy Rollback Forgery',
    badge: 'Billing Theft',
    shortDesc: 'Cumulative Wh reduced by 75%; original HMAC unchanged (energy rollback rule secondary).',
    expectedDefense: 'HMAC + Energy Rollback Rule → REJECTED',
  },
  {
    key: 'stale_timestamp',
    label: '4. Timestamp Tampering / Replay Injection',
    badge: 'Delayed Ingest',
    shortDesc: 'Timestamp set 180s in past; original HMAC unchanged (freshness check secondary).',
    expectedDefense: 'HMAC + Freshness Skew Check → REJECTED',
  },
  {
    key: 'seq_replay',
    label: '5. Sequence Number Replay',
    badge: 'Replay Protection',
    shortDesc: 'Reuses previously accepted sequence number with valid captured HMAC.',
    expectedDefense: 'Sequence Monotonicity Check → REJECTED',
  },
  {
    key: 'historical_spike',
    label: '6. Historical Spike Tampering',
    badge: 'Behavioral Anomaly',
    shortDesc: 'Sudden 2.8x power surge with valid recomputed HMAC & consistent V×I law.',
    expectedDefense: 'Historical Behavior Rule → FLAGGED / WARNING',
  },
];

export const AttackSimulationPage: React.FC<AttackSimulationPageProps> = ({
  meters,
  onRunMitm,
  onIngestPacket,
  mitmResult,
}) => {
  const [targetMeter, setTargetMeter] = useState<string>('MTR-002');
  const [selectedScenario, setSelectedScenario] = useState<MitmScenarioKey>(
    mitmResult?.scenarioKey || 'current_power'
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeMode, setActiveMode] = useState<'attack' | 'defense' | null>(
    mitmResult?.mode || null
  );
  const [showMoreDetails, setShowMoreDetails] = useState<boolean>(true);
  const [animStep, setAnimStep] = useState<number>(0);
  const [pastedJson, setPastedJson] = useState<string>('');
  const [pasteLoading, setPasteLoading] = useState<boolean>(false);
  const [pasteResult, setPasteResult] = useState<{ raw: string; verdict: Verdict } | null>(null);
  const [copiedRaw, setCopiedRaw] = useState<boolean>(false);

  // Pre-populate with initial simulation on mount if not present
  useEffect(() => {
    if (!mitmResult) {
      onRunMitm('defense', 'MTR-002', 'current_power');
    }
  }, []);

  // Sync selectedScenario if mitmResult updates externally
  useEffect(() => {
    if (mitmResult?.scenarioKey) {
      setSelectedScenario(mitmResult.scenarioKey);
    }
  }, [mitmResult?.scenarioKey]);

  // Trigger staged step animation when a new simulation result arrives
  useEffect(() => {
    if (mitmResult) {
      setAnimStep(1);
      const timer1 = setTimeout(() => setAnimStep(2), 350);
      const timer2 = setTimeout(() => setAnimStep(3), 700);
      const timer3 = setTimeout(() => setAnimStep(4), 1050);
      const timer4 = setTimeout(() => setAnimStep(5), 1400);
      const timer5 = setTimeout(() => setAnimStep(6), 1750);
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
        clearTimeout(timer4);
        clearTimeout(timer5);
      };
    }
  }, [mitmResult]);

  const handleSimulate = async (mode: 'attack' | 'defense') => {
    setIsLoading(true);
    setActiveMode(mode);
    try {
      await onRunMitm(mode, targetMeter, selectedScenario);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendPasted = async () => {
    if (!pastedJson.trim()) return;
    setPasteLoading(true);
    try {
      const verdict = await onIngestPacket(pastedJson.trim());
      setPasteResult({ raw: pastedJson.trim(), verdict });
    } finally {
      setPasteLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  const getVerdictBadge = (label: Verdict['label']) => {
    switch (label) {
      case 'ACCEPTED':
        return (
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded text-xs font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> ACCEPTED
          </span>
        );
      case 'FLAGGED':
        return (
          <span className="bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-0.5 rounded text-xs font-bold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> FLAGGED / WARNING
          </span>
        );
      case 'REJECTED':
        return (
          <span className="bg-red-100 text-red-800 border border-red-300 px-2.5 py-0.5 rounded text-xs font-bold flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5 text-red-600" /> REJECTED
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="bg-gray-100 text-gray-700 border border-gray-300 px-2.5 py-0.5 rounded text-xs font-bold flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-gray-600" /> BLOCKED
          </span>
        );
    }
  };

  const isNormalCase = mitmResult?.scenarioKey === 'normal';
  const isWarningCase = mitmResult?.verdict.label === 'FLAGGED';
  const isRejectedCase = mitmResult?.verdict.label === 'REJECTED';

  const isPrimaryCheck = (checkName: string) => {
    if (!mitmResult) return false;
    const normPrimary = mitmResult.primaryDefenseLayer.toLowerCase();
    const normCheck = checkName.toLowerCase();
    if (normPrimary.includes('none')) return false;
    if (normPrimary.includes('hmac') && normCheck.includes('hmac')) return true;
    if (normPrimary.includes('timestamp') && normCheck.includes('timestamp')) return true;
    if (normPrimary.includes('sequence') && normCheck.includes('sequence')) return true;
    if (normPrimary.includes('historical') && normCheck.includes('historical')) return true;
    return false;
  };

  const secondaryFailedChecks = mitmResult
    ? mitmResult.defenseEvaluation.filter(
        chk => chk.result === 'Failed' && !isPrimaryCheck(chk.checkName)
      )
    : [];

  const passedChecks = mitmResult
    ? mitmResult.defenseEvaluation.filter(chk => chk.result === 'Passed')
    : [];

  return (
    <div className="space-y-6">
      {/* Module Title Header */}
      <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eceef1] pb-3 mb-3">
          <div>
            <h2 className="text-lg font-bold text-[#1f2933] flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-600" />
              Man-in-the-Middle (MITM) Attack
            </h2>
            <p className="text-xs text-[#66707d] mt-0.5">
              Simulate telemetry packet interception, targeted payload tampering, and verify how layered security mechanisms (HMAC, timestamp freshness, sequence counters, and behavioral analysis) defend the smart grid.
            </p>
          </div>
          <div className="text-[11px] bg-slate-50 border border-slate-200 px-2.5 py-1 rounded text-slate-700 font-mono">
            NISTIR 7628 Multi-Layer Defense Sandbox
          </div>
        </div>

        {/* Target Selector & Simulation Case Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Target Meter Selector */}
          <div>
            <label className="text-xs font-bold text-[#1f2933] block mb-1.5">
              Target Smart Meter:
            </label>
            <div className="flex items-center gap-2">
              {Object.entries(meters).map(([mid, m]) => (
                <button
                  key={mid}
                  onClick={() => setTargetMeter(mid)}
                  className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold border transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    targetMeter === mid
                      ? 'bg-[#1d4ed8] text-white border-[#1d4ed8] shadow-xs'
                      : 'bg-white text-[#1f2933] border-[#d8dce2] hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      mid === 'MTR-001' ? 'bg-blue-300' : 'bg-orange-300'
                    }`}
                  />
                  {m.name} ({mid})
                </button>
              ))}
            </div>
          </div>

          {/* Simulation Case Selector */}
          <div>
            <label className="text-xs font-bold text-[#1f2933] block mb-1.5">
              Simulation Scenario Case:
            </label>
            <select
              value={selectedScenario}
              onChange={e => setSelectedScenario(e.target.value as MitmScenarioKey)}
              className="w-full text-xs bg-white border border-[#d8dce2] rounded px-3 py-1.5 text-[#1f2933] focus:outline-hidden focus:border-[#1d4ed8] font-medium"
            >
              {SCENARIOS.map(s => (
                <option key={s.key} value={s.key}>
                  {s.label} — {s.badge}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scenario Description Banner */}
        <div className="mt-3 p-2.5 rounded bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between text-xs">
          <div>
            <span className="font-bold text-slate-800">
              {SCENARIOS.find(s => s.key === selectedScenario)?.label}:
            </span>{' '}
            <span className="text-slate-600">
              {SCENARIOS.find(s => s.key === selectedScenario)?.shortDesc}
            </span>
          </div>
          <div className="text-[11px] font-mono text-[#1d4ed8] font-semibold mt-1 sm:mt-0">
            Expected: {SCENARIOS.find(s => s.key === selectedScenario)?.expectedDefense}
          </div>
        </div>

        {/* Single Main Simulation Button */}
        <div className="mt-4 pt-3 border-t border-[#eceef1]">
          <button
            onClick={() => handleSimulate('defense')}
            disabled={isLoading}
            className="w-full py-2.5 px-4 rounded text-xs font-bold bg-[#1d4ed8] text-white hover:bg-blue-800 disabled:opacity-50 transition-colors shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            {isLoading
              ? 'Running Simulation...'
              : 'Simulation'}
          </button>
        </div>
      </div>

      {/* Visual Step-by-Step Flow Diagram */}
      <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
        <div className="flex items-center justify-between mb-3 border-b border-[#eceef1] pb-2">
          <span className="text-xs font-bold text-[#1f2933] flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-[#1d4ed8]" />
            Communication Flow Diagram:
            <span className="font-semibold text-slate-600">
              {isNormalCase
                ? 'Meter → Gateway (Direct Authentic Channel)'
                : 'Meter → MITM Interceptor → Gateway → Multi-Layer Defense'}
            </span>
          </span>
          <span className="text-[11px] text-[#66707d]">
            Target: {meters[targetMeter]?.name || targetMeter}
          </span>
        </div>

        {/* SVG Animated Node Flow */}
        <div className="py-2 px-2 overflow-x-auto">
          {isNormalCase ? (
            /* Case 1: Direct Transmission (No Interceptor) */
            <div className="min-w-[500px] flex items-center justify-around relative py-2">
              {/* Step 1: Meter Node */}
              <div
                className={`w-52 p-3 rounded-md border text-center transition-all ${
                  animStep >= 1
                    ? 'bg-emerald-50/80 border-emerald-500 shadow-xs'
                    : 'bg-gray-50 border-[#d8dce2] opacity-75'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto mb-1.5">
                  <Cpu className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-[#1f2933]">1. Smart Meter</div>
                <div className="text-[10px] text-[#66707d]">{targetMeter}</div>
                <div className="text-[10px] text-emerald-700 font-medium mt-1">
                  Generates & signs genuine packet
                </div>
              </div>

              {/* Direct Arrow */}
              <div className="px-4 flex flex-col items-center flex-1 max-w-xs">
                <div className="text-[9px] font-mono text-emerald-700 font-semibold mb-0.5">
                  Direct encrypted channel (no tampering)
                </div>
                <div className="w-full h-0.5 bg-emerald-500 relative">
                  <div
                    className={`absolute -top-1 right-0 w-2 h-2 border-t-2 border-r-2 border-emerald-600 rotate-45 transition-opacity ${
                      animStep >= 2 ? 'opacity-100' : 'opacity-30'
                    }`}
                  />
                </div>
              </div>

              {/* Step 2: Gateway Node */}
              <div
                className={`w-52 p-3 rounded-md border text-center transition-all ${
                  animStep >= 2
                    ? 'bg-emerald-50/80 border-emerald-600 shadow-xs'
                    : 'bg-gray-50 border-[#d8dce2] opacity-75'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center mx-auto mb-1.5">
                  <Server className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-[#1f2933]">2. GridGuard Gateway</div>
                <div className="text-[10px] text-[#66707d]">Substation Ingestion</div>
                <div className="text-[10px] text-emerald-700 font-bold mt-1">
                  Accepted (All checks pass)
                </div>
              </div>
            </div>
          ) : (
            /* Cases 2-6: MITM Interceptor Flow */
            <div className="min-w-[620px] flex items-center justify-between relative">
              {/* Step 1: Meter Node */}
              <div
                className={`flex-1 p-3 rounded-md border text-center transition-all ${
                  animStep >= 1
                    ? 'bg-blue-50/80 border-[#1d4ed8] shadow-xs'
                    : 'bg-gray-50 border-[#d8dce2] opacity-75'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-[#1d4ed8] text-white flex items-center justify-center mx-auto mb-1.5">
                  <Cpu className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-[#1f2933]">1. Smart Meter</div>
                <div className="text-[10px] text-[#66707d]">{targetMeter}</div>
                <div className="text-[10px] text-emerald-700 font-medium mt-1">
                  Generates & signs genuine packet
                </div>
              </div>

              {/* Arrow 1 */}
              <div className="px-2 flex flex-col items-center">
                <div className="text-[9px] font-mono text-[#66707d] mb-0.5">wireless / UART</div>
                <div className="w-8 h-0.5 bg-[#d8dce2] relative">
                  <div
                    className={`absolute -top-1 right-0 w-2 h-2 border-t-2 border-r-2 border-[#1d4ed8] rotate-45 transition-opacity ${
                      animStep >= 2 ? 'opacity-100' : 'opacity-30'
                    }`}
                  />
                </div>
              </div>

              {/* Step 2: MITM Interceptor Node */}
              <div
                className={`flex-1 p-3 rounded-md border text-center transition-all ${
                  animStep >= 2
                    ? 'bg-red-50/90 border-red-500 shadow-xs'
                    : 'bg-gray-50 border-[#d8dce2] opacity-75'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center mx-auto mb-1.5">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-red-700">2. MITM Interceptor</div>
                <div className="text-[10px] text-[#66707d]">Adversary Proxy</div>
                <div className="text-[10px] text-red-700 font-medium mt-1">
                  {selectedScenario === 'seq_replay'
                    ? 'Captures & replays old seq'
                    : selectedScenario === 'historical_spike'
                    ? 'Injects surge & signs'
                    : 'Intercepts & alters payload'}
                </div>
              </div>

              {/* Arrow 2 */}
              <div className="px-2 flex flex-col items-center">
                <div className="text-[9px] font-mono text-red-600 mb-0.5">
                  {selectedScenario === 'seq_replay' ? 'replayed frame' : 'modified packet'}
                </div>
                <div className="w-8 h-0.5 bg-red-400 relative">
                  <div
                    className={`absolute -top-1 right-0 w-2 h-2 border-t-2 border-r-2 border-red-600 rotate-45 transition-opacity ${
                      animStep >= 3 ? 'opacity-100' : 'opacity-30'
                    }`}
                  />
                </div>
              </div>

              {/* Step 3: Gateway Node */}
              <div
                className={`flex-1 p-3 rounded-md border text-center transition-all ${
                  animStep >= 3
                    ? 'bg-slate-100 border-slate-400 shadow-xs'
                    : 'bg-gray-50 border-[#d8dce2] opacity-75'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center mx-auto mb-1.5">
                  <Server className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-[#1f2933]">3. GridGuard Gateway</div>
                <div className="text-[10px] text-[#66707d]">Substation Ingestion</div>
                <div className="text-[10px] text-slate-700 font-medium mt-1">
                  Evaluates security rules
                </div>
              </div>

              {/* Step 4: Defense Checks Node */}
              <div className="px-2 flex flex-col items-center">
                <div className="text-[9px] font-mono text-blue-600 mb-0.5">defense pipeline</div>
                <div className="w-8 h-0.5 bg-blue-400 relative">
                  <div
                    className={`absolute -top-1 right-0 w-2 h-2 border-t-2 border-r-2 border-[#1d4ed8] rotate-45 transition-opacity ${
                      animStep >= 4 ? 'opacity-100' : 'opacity-30'
                    }`}
                  />
                </div>
              </div>

              <div
                className={`flex-1 p-3 rounded-md border text-center transition-all ${
                  animStep >= 4
                    ? isWarningCase
                      ? 'bg-amber-50/90 border-amber-500 shadow-xs'
                      : 'bg-red-50/90 border-red-500 shadow-xs'
                    : 'bg-gray-50 border-[#d8dce2] opacity-75'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full text-white flex items-center justify-center mx-auto mb-1.5 ${
                    isWarningCase ? 'bg-amber-600' : 'bg-red-600'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div
                  className={`text-xs font-bold ${
                    isWarningCase ? 'text-amber-900' : 'text-red-900'
                  }`}
                >
                  4. Defense Checks
                </div>
                <div className="text-[10px] text-[#66707d] truncate">
                  {mitmResult?.primaryDefenseLayer.split(':')[0] || 'Multi-Layer'}
                </div>
                <div
                  className={`text-[10px] font-bold mt-1 ${
                    isWarningCase ? 'text-amber-800' : 'text-red-700'
                  }`}
                >
                  {isWarningCase ? 'Behavior Warning' : 'Catches & Rejects!'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Simulation Result Presentation Area */}
      {!mitmResult ? (
        <div className="text-center py-10 bg-white border border-dashed border-[#d8dce2] rounded text-sm text-[#66707d]">
          Click <strong className="text-[#1d4ed8]">“Simulation”</strong> to run the selected scenario end to end and inspect multi-layer defense results.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Prominent Header Banner with Clear Color Scheme */}
          <div
            className={`border-l-4 rounded-md p-4 shadow-2xs ${
              isNormalCase
                ? 'bg-emerald-50 border-l-emerald-600 border-y border-r border-emerald-200 text-emerald-950'
                : isWarningCase
                ? 'bg-amber-50 border-l-amber-600 border-y border-r border-amber-200 text-amber-950'
                : 'bg-red-50 border-l-red-600 border-y border-r border-red-200 text-red-950'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span
                  className={`text-xs font-bold uppercase tracking-wider block ${
                    isNormalCase
                      ? 'text-emerald-700'
                      : isWarningCase
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}
                >
                  End-to-End Simulation — {mitmResult.scenarioTitle}
                </span>
                <h3 className="text-base font-bold text-[#1f2933] mt-0.5">
                  {mitmResult.verdictSummary}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {getVerdictBadge(mitmResult.verdict.label)}
                <button
                  onClick={() => setShowMoreDetails(!showMoreDetails)}
                  className="text-xs font-semibold px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                  title="Toggle more details"
                >
                  {showMoreDetails ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  {showMoreDetails ? 'Less details' : 'More details'}
                </button>
              </div>
            </div>

            {/* Execution Status Badges */}
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-2.5 border-t border-slate-200">
              <span className="text-[11px] font-semibold text-slate-700">Execution Status:</span>
              {mitmResult.statusSteps.map((step, idx) => (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${
                    step.status === 'success'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : step.status === 'warning'
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : step.status === 'danger'
                      ? 'bg-red-100 text-red-800 border-red-200'
                      : 'bg-blue-100 text-blue-800 border-blue-200'
                  }`}
                >
                  {step.status === 'success' ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : step.status === 'warning' ? (
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                  ) : (
                    <ArrowRight className="w-3 h-3 text-blue-600" />
                  )}
                  {step.title}
                </span>
              ))}
            </div>
          </div>

          {/* Diagnostic Summary Card: Exact defense layer, HMAC state, and reason */}
          <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs space-y-3">
            <div className="text-xs font-bold text-[#1f2933] border-b border-[#eceef1] pb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#1d4ed8]" />
                Defense Layer Analysis & Cryptographic Disposition
              </span>
              <span className="text-[11px] text-[#66707d]">Layered Security Model</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-2.5 rounded border border-slate-200 bg-slate-50">
                <span className="text-[11px] text-[#66707d] block font-semibold">
                  Primary Defense Trigger:
                </span>
                <span
                  className={`text-xs font-bold mt-0.5 block ${
                    isNormalCase
                      ? 'text-emerald-700'
                      : isWarningCase
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}
                >
                  {mitmResult.primaryDefenseLayer}
                </span>
              </div>

              <div className="p-2.5 rounded border border-slate-200 bg-slate-50">
                <span className="text-[11px] text-[#66707d] block font-semibold">
                  HMAC Signature State:
                </span>
                <span className="text-xs font-semibold text-slate-800 mt-0.5 block">
                  {mitmResult.hmacStatus}
                </span>
              </div>

              <div className="p-2.5 rounded border border-slate-200 bg-slate-50">
                <span className="text-[11px] text-[#66707d] block font-semibold">
                  Final Gateway Verdict:
                </span>
                <div className="mt-0.5">{getVerdictBadge(mitmResult.verdict.label)}</div>
              </div>
            </div>

            {/* Check Disposition Breakdown: Primary vs Secondary vs Passed */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-2.5 rounded bg-slate-50/90 border border-slate-200 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Primary Defense Trigger
                </span>
                <span className="font-bold text-slate-900 mt-0.5 block">
                  {mitmResult.primaryDefenseLayer}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Secondary Failed Checks
                </span>
                <span className="text-slate-800 mt-0.5 block">
                  {secondaryFailedChecks.length > 0 ? (
                    secondaryFailedChecks.map(c => c.checkName.replace(/^[0-9]+\.\s*/, '')).join(', ')
                  ) : (
                    <span className="text-slate-500 italic">None</span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Passed Checks
                </span>
                <span className="text-emerald-700 font-semibold mt-0.5 block">
                  {passedChecks.length} of 6 checks passed
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-blue-50/70 border border-blue-200 text-xs text-blue-950">
              <span className="font-bold block mb-0.5">Why this defense layer is appropriate:</span>
              <p className="leading-relaxed">{mitmResult.defenseReason}</p>
            </div>

            {/* Special Callout for Sequence Number Replay Case */}
            {mitmResult.seqDetails && (
              <div className="p-3 rounded border border-red-300 bg-red-50 text-xs text-red-950 space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-red-900">
                  <RotateCcw className="w-4 h-4 text-red-600" />
                  Sequence Replay Protection Breakdown:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-white p-2 rounded border border-red-200">
                    <span className="text-[#66707d] block">Previous Accepted Sequence Number:</span>
                    <span className="font-mono font-bold text-slate-900">
                      #{mitmResult.seqDetails.previousAcceptedSeq}
                    </span>
                  </div>
                  <div className="bg-white p-2 rounded border border-red-200">
                    <span className="text-[#66707d] block">Received Sequence Number:</span>
                    <span className="font-mono font-bold text-red-700">
                      #{mitmResult.seqDetails.receivedSeq} (Replayed)
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-red-800 pt-1">
                  <strong>Rejection Reason:</strong> {mitmResult.seqDetails.reason}
                </p>
              </div>
            )}
          </div>

          {/* Side-by-Side Comparison: Original vs Ingested Packet */}
          <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
            <div className="text-xs font-bold text-[#1f2933] border-b border-[#eceef1] pb-2 mb-3 flex items-center justify-between">
              <span>Telemetry Packet Comparison (Original vs Ingested Frame)</span>
              <span className="text-[11px] font-normal text-red-600 font-semibold">
                {isNormalCase
                  ? '● Clean direct transmission (values identical)'
                  : '● Highlighted values indicate altered/replayed parameters'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Original Packet Values */}
              <div className="border border-emerald-200 bg-emerald-50/30 rounded p-3 text-xs space-y-1.5">
                <div className="font-bold text-emerald-800 text-xs flex items-center justify-between pb-1.5 border-b border-emerald-200">
                  <span>Legitimate Meter Packet</span>
                  <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-mono text-[10px]">
                    Signed by {targetMeter}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Meter ID:</span>
                  <span className="font-mono font-bold text-[#1f2933]">
                    {mitmResult.originalPacket.meter_id}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Sequence Number:</span>
                  <span className="font-mono text-[#1f2933]">{mitmResult.originalPacket.seq}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Timestamp:</span>
                  <span className="font-mono text-[#1f2933]">{mitmResult.originalPacket.ts}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Voltage:</span>
                  <span className="font-mono text-[#1f2933]">
                    {mitmResult.originalPacket.voltage_v} V
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Current:</span>
                  <span className="font-mono font-bold text-emerald-800">
                    {mitmResult.originalPacket.current_a} A
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Active Power:</span>
                  <span className="font-mono font-bold text-emerald-800">
                    {mitmResult.originalPacket.power_kw} kW
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Cumulative Energy:</span>
                  <span className="font-mono text-[#1f2933]">
                    {mitmResult.originalPacket.energy_wh} Wh
                  </span>
                </div>
                <div className="pt-1 text-[10px] text-[#66707d] truncate font-mono">
                  HMAC: {mitmResult.originalPacket.hmac}
                </div>
              </div>

              {/* Modified / Received Packet Values */}
              <div
                className={`border rounded p-3 text-xs space-y-1.5 ${
                  isNormalCase
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : isWarningCase
                    ? 'border-amber-200 bg-amber-50/30'
                    : 'border-red-200 bg-red-50/30'
                }`}
              >
                <div
                  className={`font-bold text-xs flex items-center justify-between pb-1.5 border-b ${
                    isNormalCase
                      ? 'text-emerald-800 border-emerald-200'
                      : isWarningCase
                      ? 'text-amber-800 border-amber-200'
                      : 'text-red-800 border-red-200'
                  }`}
                >
                  <span>
                    {isNormalCase
                      ? 'Direct Ingested Packet'
                      : 'Modified Packet Forwarded to Gateway'}
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono text-[10px] ${
                      isNormalCase
                        ? 'bg-emerald-100 text-emerald-800'
                        : isWarningCase
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {isNormalCase ? 'Clean' : 'Tampered / Injected'}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Meter ID:</span>
                  <span className="font-mono font-bold text-[#1f2933]">
                    {mitmResult.modifiedPacket.meter_id}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Sequence Number:</span>
                  <span
                    className={`font-mono ${
                      mitmResult.tamperedFields.includes('seq')
                        ? 'bg-red-200 text-red-900 font-bold px-1.5 py-0.5 rounded border border-red-300'
                        : 'text-[#1f2933]'
                    }`}
                  >
                    {mitmResult.modifiedPacket.seq}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Timestamp:</span>
                  <span
                    className={`font-mono ${
                      mitmResult.tamperedFields.includes('ts')
                        ? 'bg-red-200 text-red-900 font-bold px-1.5 py-0.5 rounded border border-red-300'
                        : 'text-[#1f2933]'
                    }`}
                  >
                    {mitmResult.modifiedPacket.ts}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Voltage:</span>
                  <span className="font-mono text-[#1f2933]">
                    {mitmResult.modifiedPacket.voltage_v} V
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Current:</span>
                  <span
                    className={`font-mono ${
                      mitmResult.tamperedFields.includes('current_a')
                        ? 'bg-red-200 text-red-900 font-bold px-1.5 py-0.5 rounded border border-red-300'
                        : 'text-[#1f2933]'
                    }`}
                  >
                    {mitmResult.modifiedPacket.current_a} A
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Active Power:</span>
                  <span
                    className={`font-mono ${
                      mitmResult.tamperedFields.includes('power_kw')
                        ? isWarningCase
                          ? 'bg-amber-200 text-amber-900 font-bold px-1.5 py-0.5 rounded border border-amber-300'
                          : 'bg-red-200 text-red-900 font-bold px-1.5 py-0.5 rounded border border-red-300'
                        : 'text-[#1f2933]'
                    }`}
                  >
                    {mitmResult.modifiedPacket.power_kw} kW
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#66707d]">Cumulative Energy:</span>
                  <span
                    className={`font-mono ${
                      mitmResult.tamperedFields.includes('energy_wh')
                        ? 'bg-red-200 text-red-900 font-bold px-1.5 py-0.5 rounded border border-red-300'
                        : 'text-[#1f2933]'
                    }`}
                  >
                    {mitmResult.modifiedPacket.energy_wh} Wh
                  </span>
                </div>
                <div
                  className={`pt-1 text-[10px] font-mono truncate ${
                    isNormalCase
                      ? 'text-[#66707d]'
                      : isWarningCase
                      ? 'text-amber-800'
                      : 'text-red-700'
                  }`}
                >
                  HMAC: {mitmResult.modifiedPacket.hmac} ({mitmResult.hmacStatus})
                </div>
              </div>
            </div>

            {/* Changed Fields Highlight Summary */}
            <div className="mt-3 p-2.5 rounded bg-slate-50 border border-slate-200 text-xs">
              <span className="font-bold text-slate-800">Tampered Fields Breakdown:</span>
              <div className="mt-1 space-y-1">
                {mitmResult.tamperedFieldDetails.length === 0 ? (
                  <div className="text-emerald-700 font-semibold flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    None — Direct transmission, all payload values match original genuine meter packet.
                  </div>
                ) : (
                  mitmResult.tamperedFieldDetails.map((detail, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[#1f2933]">
                      <span className="font-mono font-bold text-red-600">[{detail.field}]:</span>
                      <span>
                        Changed from{' '}
                        <strong className="text-emerald-700">
                          {detail.originalValue} {detail.unit}
                        </strong>{' '}
                        to{' '}
                        <strong
                          className={isWarningCase ? 'text-amber-700' : 'text-red-700'}
                        >
                          {detail.modifiedValue} {detail.unit}
                        </strong>{' '}
                        — {detail.reason}.
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Defense Result Table: Every Case Displays 6 Mandatory Rows */}
          <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs space-y-3">
            <div className="text-xs font-bold text-[#1f2933] border-b border-[#eceef1] pb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#1d4ed8]" />
                Defense Result Table: Multi-Layer Verification
              </span>
              <span className="text-[11px] text-[#66707d]">
                Evaluates All 6 Gateway Security Layers
              </span>
            </div>

            {/* Prominent Defense Summary Alert Box */}
            <div
              className={`p-3 rounded border text-xs ${
                isNormalCase
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : isWarningCase
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-red-50 border-red-300 text-red-900'
              }`}
            >
              <div className="font-bold text-sm flex items-center gap-2">
                {isNormalCase ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : isWarningCase ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                {mitmResult.verdictSummary}
              </div>
              <p className="mt-1 leading-relaxed">
                <strong>Primary Defense Trigger:</strong> {mitmResult.primaryDefenseLayer}
              </p>
              <p className="mt-0.5 text-[11px] opacity-90">
                {mitmResult.defenseReason}
              </p>

              {/* Three-way check breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2.5 pt-2 border-t border-current/20 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
                    Primary Defense Trigger
                  </span>
                  <span className="font-bold block mt-0.5">
                    {mitmResult.primaryDefenseLayer}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
                    Secondary Failed Checks
                  </span>
                  <span className="block mt-0.5">
                    {secondaryFailedChecks.length > 0
                      ? secondaryFailedChecks
                          .map(c => c.checkName.replace(/^[0-9]+\.\s*/, ''))
                          .join(', ')
                      : 'None'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
                    Passed Checks
                  </span>
                  <span className="block mt-0.5 font-semibold">
                    {passedChecks.length} of 6 checks passed
                  </span>
                </div>
              </div>
            </div>

            {/* Multi-Layer Checks Table with 6 Rows */}
            <div className="border border-[#d8dce2] rounded overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#fafbfc] border-b border-[#d8dce2] text-[#66707d]">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold w-1/4">Security Check Layer</th>
                    <th className="py-2.5 px-3 font-semibold w-2/5">Gateway Finding</th>
                    <th className="py-2.5 px-3 font-semibold w-1/6">Result</th>
                    <th className="py-2.5 px-3 font-semibold">Short Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eceef1]">
                  {mitmResult.defenseEvaluation.map((chk, i) => {
                    const isPrimary = isPrimaryCheck(chk.checkName);
                    const isSecondaryFail = chk.result === 'Failed' && !isPrimary;
                    return (
                      <tr
                        key={i}
                        className={
                          chk.result === 'Failed'
                            ? isPrimary
                              ? 'bg-red-50/80 hover:bg-red-50/90 font-medium'
                              : 'bg-red-50/40 hover:bg-red-50/60'
                            : chk.result === 'Warning'
                            ? 'bg-amber-50/50 hover:bg-amber-50/70'
                            : 'hover:bg-gray-50/50'
                        }
                      >
                        <td className="py-2.5 px-3 text-[#1f2933]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold">{chk.checkName}</span>
                            {isPrimary && (
                              <span className="bg-blue-100 text-blue-800 border border-blue-200 font-bold px-1.5 py-0.2 rounded text-[9px] uppercase shrink-0">
                                Primary Trigger
                              </span>
                            )}
                            {isSecondaryFail && (
                              <span className="bg-red-100 text-red-700 border border-red-200 font-medium px-1.5 py-0.2 rounded text-[9px] uppercase shrink-0">
                                Secondary Failure
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[#66707d]">{chk.detail}</td>
                        <td className="py-2.5 px-3">
                          {chk.result === 'Failed' ? (
                            <span className="bg-red-100 text-red-800 border border-red-300 font-bold px-2 py-0.5 rounded text-[10px] uppercase inline-flex items-center gap-1">
                              <XCircle className="w-3 h-3 text-red-600" /> Failed
                            </span>
                          ) : chk.result === 'Warning' ? (
                            <span className="bg-amber-100 text-amber-800 border border-amber-300 font-bold px-2 py-0.5 rounded text-[10px] uppercase inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-amber-600" /> Warning
                            </span>
                          ) : (
                            <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold px-2 py-0.5 rounded text-[10px] uppercase inline-flex items-center gap-1">
                              <Check className="w-3 h-3 text-emerald-600" /> Passed
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[#1f2933] font-medium">{chk.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Real World Impact */}
            <div className="bg-blue-50/60 border border-blue-200 p-2.5 rounded text-xs text-blue-900">
              <strong className="block mb-0.5 text-blue-950">Real-World Grid Impact:</strong>
              {mitmResult.realWorldImpact}
            </div>
          </div>

          {/* More Details Expandable Section */}
          {showMoreDetails && (
            <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs space-y-4">
              <div className="text-xs font-bold text-[#1f2933] border-b border-[#eceef1] pb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-[#1d4ed8]" />
                  {isNormalCase
                    ? 'More Details: Direct Communication & Defense Validation'
                    : 'More Details: MITM Interception & Multi-Layer Defense Pipeline'}
                </span>
                <span className="text-[11px] text-[#66707d]">Diagnostic Step View</span>
              </div>

              {/* Numbered Step-by-Step Flow Explanation */}
              {isNormalCase ? (
                /* Step-by-step for Normal case */
                <div className="space-y-2 text-xs">
                  <div className="text-xs font-semibold text-[#1f2933] mb-1">
                    Direct Clean Transmission Flow:
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 1
                        ? 'bg-emerald-50/70 border-emerald-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      1
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        1. Smart Meter generates authentic packet:
                      </strong>
                      <p className="text-[#66707d] mt-0.5">
                        {targetMeter} measures physical voltage ({mitmResult.originalPacket.voltage_v}V), current ({mitmResult.originalPacket.current_a}A), active power ({mitmResult.originalPacket.power_kw}kW), and signs canonical tokens with its private key.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 2
                        ? 'bg-blue-50/70 border-blue-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-[#1d4ed8] text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      2
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">2. Direct channel delivery:</strong>
                      <p className="text-[#66707d] mt-0.5">
                        No adversary intercepts or modifies the wireless/serial stream in-transit.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 3
                        ? 'bg-emerald-50/70 border-emerald-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      3
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        3. Gateway validates and accepts packet:
                      </strong>
                      <p className="text-emerald-700 font-semibold mt-0.5">
                        HMAC signature verified, timestamp fresh, sequence monotonic, and power consistent. Telemetry stored into historical database.
                      </p>
                    </div>
                  </div>
                </div>
              ) : selectedScenario === 'seq_replay' ? (
                /* Step-by-step for Sequence Replay case */
                <div className="space-y-2 text-xs">
                  <div className="text-xs font-semibold text-[#1f2933] mb-1">
                    Sequence Replay Attack Flow:
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 1
                        ? 'bg-blue-50/70 border-blue-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-[#1d4ed8] text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      1
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">1. Legitimate packet emitted earlier:</strong>
                      <p className="text-[#66707d] mt-0.5">
                        Smart meter previously generated and signed packet #{mitmResult.seqDetails?.receivedSeq}.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 2
                        ? 'bg-amber-50/70 border-amber-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      2
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        2. Interceptor captures authentic frame:
                      </strong>
                      <p className="text-[#66707d] mt-0.5">
                        Adversary saves the genuine packet along with its authentic HMAC signature.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 3
                        ? 'bg-red-50/70 border-red-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      3
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        3. Interceptor re-injects stale sequence #{mitmResult.seqDetails?.receivedSeq}:
                      </strong>
                      <p className="text-[#66707d] mt-0.5">
                        Adversary re-transmits the old frame downstream to the gateway after the gateway has already advanced to sequence #{mitmResult.seqDetails?.previousAcceptedSeq}.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 4
                        ? 'bg-slate-100 border-slate-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      4
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">4. Gateway verifies HMAC (Passes):</strong>
                      <p className="text-[#66707d] mt-0.5">
                        Because the captured frame was genuinely signed, the HMAC check passes.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 5
                        ? 'bg-red-50/70 border-red-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-red-700 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      5
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        5. Gateway Sequence Monotonicity Replay Defense Triggers:
                      </strong>
                      <p className="text-red-700 font-bold mt-0.5">
                        Sequence #{mitmResult.seqDetails?.receivedSeq} ≤ Last accepted #{mitmResult.seqDetails?.previousAcceptedSeq}. Packet dropped immediately as a replay attack!
                      </p>
                    </div>
                  </div>
                </div>
              ) : selectedScenario === 'historical_spike' ? (
                /* Step-by-step for Historical Spike Tampering */
                <div className="space-y-2 text-xs">
                  <div className="text-xs font-semibold text-[#1f2933] mb-1">
                    Behavioral Anomaly Simulation Flow:
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 1
                        ? 'bg-blue-50/70 border-blue-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-[#1d4ed8] text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      1
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">1. Meter sends a legitimate packet:</strong>
                      <p className="text-[#66707d] mt-0.5">
                        {targetMeter} measures normal physical readings ({mitmResult.originalPacket.power_kw} kW).
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 2
                        ? 'bg-amber-50/70 border-amber-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      2
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">2. Interceptor injects sudden surge:</strong>
                      <p className="text-[#66707d] mt-0.5">
                        Power increased by 2.8x to {mitmResult.modifiedPacket.power_kw} kW while staying within physical equipment breaker limits.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 3
                        ? 'bg-blue-50/70 border-blue-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      3
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        3. Cryptographic signature recomputed (HMAC Passes):
                      </strong>
                      <p className="text-[#66707d] mt-0.5">
                        Demonstrating that even if an attacker possesses the signing key or injects valid signatures, behavior analysis still provides security.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 4
                        ? 'bg-amber-50/70 border-amber-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      4
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        4. Gateway Historical Behavior Rule flags anomaly:
                      </strong>
                      <p className="text-amber-800 font-bold mt-0.5">
                        “Warning: sudden power spike detected. This is not automatically confirmed as an attack.” Marked as FLAGGED / WARNING.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Standard MITM Interception flow (Current/Power, Energy, Timestamp) */
                <div className="space-y-2 text-xs">
                  <div className="text-xs font-semibold text-[#1f2933] mb-1">
                    Step-by-Step Communication Flow:
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 1
                        ? 'bg-blue-50/70 border-blue-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-[#1d4ed8] text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      1
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">1. Meter sends a legitimate packet:</strong>
                      <p className="text-[#66707d] mt-0.5">
                        {targetMeter} measures physical readings (Voltage {mitmResult.originalPacket.voltage_v}V, Current {mitmResult.originalPacket.current_a}A, Power {mitmResult.originalPacket.power_kw}kW) and signs the packet using its pre-shared secret key.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 2
                        ? 'bg-amber-50/70 border-amber-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      2
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">2. Interceptor receives it:</strong>
                      <p className="text-[#66707d] mt-0.5">
                        The unauthorized MITM proxy intercepts the transmission in-transit between the smart meter and the substation.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 3
                        ? 'bg-red-50/70 border-red-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      3
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        3. Interceptor modifies {mitmResult.tamperedFields.join(', ')}:
                      </strong>
                      <p className="text-[#66707d] mt-0.5">
                        Payload values are altered in-memory while preserving the original meter ID and original HMAC signature.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 4
                        ? 'bg-orange-50/70 border-orange-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-orange-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      4
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        4. Modified packet is forwarded to the gateway:
                      </strong>
                      <p className="text-[#66707d] mt-0.5">
                        The forged packet is transmitted downstream to the GridGuard gateway socket masquerading as legitimate meter telemetry.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2.5 p-2.5 rounded border transition-all ${
                      animStep >= 5
                        ? 'bg-red-50/70 border-red-300 shadow-2xs'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-red-700 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                      5
                    </span>
                    <div>
                      <strong className="text-[#1f2933]">
                        5. Gateway evaluates and catches tampering:
                      </strong>
                      <p className="text-red-700 font-bold mt-0.5">
                        Decision: {mitmResult.verdict.label} — {mitmResult.verdictSummary}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Raw JSON Code Sent to Gateway */}
              <div className="pt-2 border-t border-[#eceef1]">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-[#66707d]">
                    Raw JSON Packet Dispatched to Gateway Socket:
                  </span>
                  <button
                    onClick={() => copyToClipboard(mitmResult.modifiedRaw)}
                    className="text-[11px] text-[#1d4ed8] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedRaw ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedRaw ? 'Copied' : 'Copy JSON'}
                  </button>
                </div>
                <pre className="bg-[#1f2933] text-[#f4f5f7] p-3 rounded text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {JSON.stringify(mitmResult.modifiedPacket, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Auxiliary: Send Serial Output From Wokwi */}
      <div className="bg-white border border-[#d8dce2] rounded-md p-4 shadow-2xs">
        <div className="text-sm font-bold text-[#1f2933] border-b border-[#d8dce2] pb-1.5 mb-2">
          Send Serial Output From Wokwi
        </div>
        <p className="text-xs text-[#66707d] mb-3">
          Paste one or more raw JSON lines from a simulated ESP32 serial monitor. The gateway will run full validation.
        </p>

        <div className="space-y-3">
          <textarea
            value={pastedJson}
            onChange={e => setPastedJson(e.target.value)}
            rows={3}
            placeholder='{"meter_id":"MTR-002","temp_c":45.0,"voltage_v":250.0,"current_a":9.5,"power_kw":2.38,"alert":true}'
            className="w-full text-xs font-mono bg-gray-50 border border-[#d8dce2] rounded p-2.5 focus:outline-hidden focus:border-[#1d4ed8] text-[#1f2933]"
          />

          <div className="flex justify-between items-center">
            <button
              onClick={() =>
                setPastedJson(
                  '{"meter_id":"MTR-002","temp_c":45.0,"voltage_v":250.0,"current_a":9.5,"power_kw":2.38,"alert":true}'
                )
              }
              className="text-xs text-[#1d4ed8] hover:underline cursor-pointer"
            >
              Insert sample abnormal reading
            </button>

            <button
              onClick={handleSendPasted}
              disabled={pasteLoading || !pastedJson.trim()}
              className="px-4 py-1.5 rounded text-xs font-semibold bg-[#1d4ed8] text-white hover:bg-blue-800 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {pasteLoading ? 'Processing...' : 'Send to Gateway'}
            </button>
          </div>

          {pasteResult && (
            <div className="mt-3 pt-3 border-t border-[#eceef1]">
              <div className="text-xs font-bold text-[#1f2933] mb-1.5 flex items-center justify-between">
                <span>Ingest Verdict:</span>
                {getVerdictBadge(pasteResult.verdict.label)}
              </div>
              <div className="text-xs text-[#66707d] bg-gray-50 p-2 rounded font-mono">
                {pasteResult.verdict.findings.length > 0 ? (
                  pasteResult.verdict.findings.map((f, i) => (
                    <div key={i}>
                      [{f.severity.toUpperCase()}] {f.type}: {f.reason}
                    </div>
                  ))
                ) : (
                  <span className="text-emerald-700 font-semibold">
                    Packet accepted and stored in telemetry database.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
