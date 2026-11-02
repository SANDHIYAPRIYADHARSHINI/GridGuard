import React, { useState } from 'react';
import { TelemetryPoint } from '../types.js';

interface ThresholdLine {
  y: number;
  color: string;
  label?: string;
}

interface LiveMetricChartProps {
  data: TelemetryPoint[];
  metricKey: keyof Pick<TelemetryPoint, 'power_kw' | 'current_a' | 'voltage_v' | 'temp_c' | 'energy_wh'>;
  title: string;
  unit: string;
  minSpan: number;
  lines: ThresholdLine[];
  floor0?: boolean;
}

export const LiveMetricChart: React.FC<LiveMetricChartProps> = ({
  data,
  metricKey,
  title,
  unit,
  minSpan,
  lines,
  floor0 = false,
}) => {
  const [hoverIdx, setHoverIdx] = useState<{ meter: string; pt: TelemetryPoint } | null>(null);

  const meterA = data.filter(d => d.meter_id === 'MTR-001');
  const meterB = data.filter(d => d.meter_id === 'MTR-002');

  const allVals = data.map(d => Number(d[metricKey]));
  let minVal = allVals.length ? Math.min(...allVals) : 0;
  let maxVal = allVals.length ? Math.max(...allVals) : 10;

  // Include threshold lines in scale calculation if close
  for (const line of lines) {
    if (Math.abs(line.y - (minVal + maxVal) / 2) < minSpan * 2) {
      minVal = Math.min(minVal, line.y);
      maxVal = Math.max(maxVal, line.y);
    }
  }

  const span = Math.max(maxVal - minVal, minSpan);
  const halfSpan = (span / 2) * 1.3;
  let lo = (minVal + maxVal) / 2 - halfSpan;
  let hi = (minVal + maxVal) / 2 + halfSpan;
  if (floor0) {
    lo = Math.max(0, lo);
  }
  const effectiveSpan = hi - lo || 1;

  // Chart dimensions
  const width = 560;
  const height = 190;
  const padL = 45;
  const padR = 20;
  const padT = 20;
  const padB = 30;

  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const getY = (val: number) => {
    const norm = (val - lo) / effectiveSpan;
    return padT + chartH - Math.max(0, Math.min(1, norm)) * chartH;
  };

  const getPointsPath = (pts: TelemetryPoint[]) => {
    if (pts.length < 2) return '';
    return pts
      .map((pt, i) => {
        const x = padL + (i / (pts.length - 1)) * chartW;
        const y = getY(Number(pt[metricKey]));
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const pathA = getPointsPath(meterA);
  const pathB = getPointsPath(meterB);

  // Y-axis ticks
  const yTicks = [lo, lo + effectiveSpan * 0.5, hi];

  // Latest timestamps
  const firstTime = data.length > 0 ? data[0].timeStr : '';
  const lastTime = data.length > 0 ? data[data.length - 1].timeStr : '';

  return (
    <div className="bg-white border border-[#d8dce2] rounded-md p-3.5 shadow-xs relative">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-[13px] font-semibold text-[#1f2933]">
          {title} <span className="font-normal text-[#66707d]">({unit})</span>
        </h3>
        <div className="flex items-center gap-3 text-xs text-[#66707d]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#1d4ed8] inline-block rounded-xs"></span> Meter A
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#c2410c] inline-block rounded-xs"></span> Meter B
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
        >
          {/* Grid lines */}
          {yTicks.map((val, idx) => {
            const y = getY(val);
            return (
              <g key={idx}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  stroke="#eceef1"
                  strokeWidth="1"
                />
                <text
                  x={padL - 6}
                  y={y + 3.5}
                  textAnchor="end"
                  className="text-[10px] fill-[#66707d]"
                >
                  {val.toFixed(metricKey === 'current_a' || metricKey === 'power_kw' ? 2 : 1)}
                </text>
              </g>
            );
          })}

          {/* Threshold dashed lines */}
          {lines.map((line, idx) => {
            if (line.y >= lo && line.y <= hi) {
              const y = getY(line.y);
              return (
                <g key={`thresh-${idx}`}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={width - padR}
                    y2={y}
                    stroke={line.color}
                    strokeWidth="1.2"
                    strokeDasharray="4 3"
                    opacity={0.85}
                  />
                  {line.label && (
                    <text
                      x={width - padR}
                      y={y - 3}
                      textAnchor="end"
                      className="text-[9px] font-medium"
                      fill={line.color}
                    >
                      {line.label}
                    </text>
                  )}
                </g>
              );
            }
            return null;
          })}

          {/* X-axis time marks */}
          <line
            x1={padL}
            y1={padT + chartH}
            x2={width - padR}
            y2={padT + chartH}
            stroke="#d8dce2"
            strokeWidth="1"
          />
          {firstTime && (
            <text
              x={padL}
              y={height - 8}
              textAnchor="start"
              className="text-[10px] fill-[#66707d]"
            >
              {firstTime}
            </text>
          )}
          {lastTime && (
            <text
              x={width - padR}
              y={height - 8}
              textAnchor="end"
              className="text-[10px] fill-[#66707d]"
            >
              {lastTime}
            </text>
          )}

          {/* Meter A Line */}
          {pathA && (
            <path
              d={pathA}
              fill="none"
              stroke="#1d4ed8"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Meter B Line */}
          {pathB && (
            <path
              d={pathB}
              fill="none"
              stroke="#c2410c"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Anomaly markers (red X) for flagged points */}
          {data.map((pt, i) => {
            if (!pt.flagged) return null;
            const pts = pt.meter_id === 'MTR-001' ? meterA : meterB;
            const pIdx = pts.findIndex(p => p.id === pt.id);
            if (pIdx === -1 || pts.length < 2) return null;
            const x = padL + (pIdx / (pts.length - 1)) * chartW;
            const y = getY(Number(pt[metricKey]));
            const size = 5;

            return (
              <g key={`flag-${pt.id}`}>
                <line
                  x1={x - size}
                  y1={y - size}
                  x2={x + size}
                  y2={y + size}
                  stroke="#b42318"
                  strokeWidth="2"
                />
                <line
                  x1={x - size}
                  y1={y + size}
                  x2={x + size}
                  y2={y - size}
                  stroke="#b42318"
                  strokeWidth="2"
                />
              </g>
            );
          })}

          {/* Interactive hover points */}
          {meterA.map((pt, i) => {
            const x = padL + (i / Math.max(1, meterA.length - 1)) * chartW;
            const y = getY(Number(pt[metricKey]));
            return (
              <circle
                key={`hover-a-${pt.id}`}
                cx={x}
                cy={y}
                r="4"
                className="opacity-0 hover:opacity-100 cursor-pointer fill-[#1d4ed8] stroke-white stroke-2 transition-opacity"
                onMouseEnter={() => setHoverIdx({ meter: 'Meter A', pt })}
                onMouseLeave={() => setHoverIdx(null)}
              />
            );
          })}

          {meterB.map((pt, i) => {
            const x = padL + (i / Math.max(1, meterB.length - 1)) * chartW;
            const y = getY(Number(pt[metricKey]));
            return (
              <circle
                key={`hover-b-${pt.id}`}
                cx={x}
                cy={y}
                r="4"
                className="opacity-0 hover:opacity-100 cursor-pointer fill-[#c2410c] stroke-white stroke-2 transition-opacity"
                onMouseEnter={() => setHoverIdx({ meter: 'Meter B', pt })}
                onMouseLeave={() => setHoverIdx(null)}
              />
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {hoverIdx && (
          <div className="absolute top-2 right-2 bg-[#1f2933] text-white text-[11px] px-2 py-1 rounded shadow-md pointer-events-none z-10 flex items-center gap-2">
            <span className="font-semibold">{hoverIdx.meter}</span>
            <span>{Number(hoverIdx.pt[metricKey]).toFixed(2)} {unit}</span>
            <span className="text-[#9aa3ad]">({hoverIdx.pt.timeStr})</span>
            {hoverIdx.pt.flagged && <span className="text-red-400 font-bold">[FLAGGED]</span>}
          </div>
        )}
      </div>
    </div>
  );
};
