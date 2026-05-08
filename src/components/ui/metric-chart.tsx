import * as React from "react";
import { cn } from "@/lib/utils";

export interface MetricChartSeries {
  name?: string;
  color: string;
  data: number[];
}

export interface MetricChartBand {
  /** Index into series[0].data marking the start of the band (inclusive). */
  startIndex: number;
  /** Index into series[0].data marking the end of the band (inclusive). */
  endIndex: number;
  /** CSS color (defaults to a soft red). */
  color?: string;
}

interface MetricChartProps {
  series: MetricChartSeries[];
  width: number;
  height: number;
  yLabels?: string[];
  xLabels?: string[];
  fill?: boolean;
  axis?: boolean;
  smooth?: boolean;
  className?: string;
  /** Optional vertical bands rendered underneath the line(s). */
  bands?: MetricChartBand[];
  /** Optional horizontal dashed line at this Y value. */
  thresholdY?: number;
  /** Optional tooltip label per point. */
  pointLabels?: string[];
  /** Optional formatter for tooltip values. */
  valueFormatter?: (value: number) => string;
}

function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[i - 1];
    const cx = (px + x) / 2;
    d += ` Q ${px},${py} ${cx},${(py + y) / 2}`;
    d += ` T ${x},${y}`;
  }
  return d;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function MetricChart({
  series,
  width,
  height,
  yLabels = ["0", "25", "50", "75", "100"],
  xLabels,
  fill = true,
  axis = true,
  smooth = true,
  className,
  bands,
  thresholdY,
  pointLabels,
  valueFormatter = (value) => String(value),
}: MetricChartProps) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState<{ x: number; y: number } | null>(null);

  const PAD_L = axis ? 38 : 4;
  const PAD_R = 4;
  const PAD_T = 6;
  const PAD_B = axis ? 18 : 4;
  const iw = width - PAD_L - PAD_R;
  const ih = height - PAD_T - PAD_B;
  const all = series.flatMap((s) => s.data);
  const min = 0;
  const dataMax = Math.max(...all, thresholdY ?? 0) || 1;
  const max = dataMax * 1.08;
  const range = max - min;
  const n = series[0]?.data.length || 1;
  const stepX = iw / Math.max(n - 1, 1);
  const yToPx = (v: number) => PAD_T + ih - ((v - min) / range) * ih;

  const tooltipLabel =
    hoveredIndex == null
      ? null
      : pointLabels?.[hoveredIndex] ??
        (xLabels && xLabels.length === n ? xLabels[hoveredIndex] : null) ??
        `#${hoveredIndex + 1}`;

  const wrapperStyle = className ? undefined : { width, height };

  return (
    <div className={cn("relative", className)} style={wrapperStyle}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        preserveAspectRatio="none"
      >
        {axis &&
          yLabels.map((_, i) => {
            const y = PAD_T + (ih * i) / (yLabels.length - 1);
            return (
              <g key={i}>
                <line
                  x1={PAD_L}
                  y1={y}
                  x2={width - PAD_R}
                  y2={y}
                  stroke="var(--line)"
                  strokeDasharray={i === yLabels.length - 1 ? "0" : "2 4"}
                />
                <text
                  x={PAD_L - 6}
                  y={y + 3}
                  fill="var(--fg-2)"
                  fontSize="11"
                  textAnchor="end"
                  fontFamily="var(--font-mono)"
                >
                  {yLabels[yLabels.length - 1 - i]}
                </text>
              </g>
            );
          })}
        {axis &&
          xLabels &&
          xLabels.map((label, i) => {
            const x = PAD_L + (iw * i) / Math.max(xLabels.length - 1, 1);
            return (
              <text
                key={i}
                x={x}
                y={height - 4}
                fill="var(--fg-2)"
                fontSize="11"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {label}
              </text>
            );
          })}
        {bands?.map((band, bi) => {
          const startIdx = Math.max(0, Math.min(band.startIndex, n - 1));
          const endIdx = Math.max(0, Math.min(band.endIndex, n - 1));
          const x1 = PAD_L + startIdx * stepX;
          const x2 = PAD_L + endIdx * stepX;
          const w = Math.max(2, x2 - x1);
          return (
            <rect
              key={`band-${bi}`}
              x={x1}
              y={PAD_T}
              width={w}
              height={ih}
              fill={band.color ?? "var(--status-error-bg)"}
              opacity={0.55}
            />
          );
        })}
        {thresholdY != null && (
          <line
            x1={PAD_L}
            x2={width - PAD_R}
            y1={yToPx(thresholdY)}
            y2={yToPx(thresholdY)}
            stroke="var(--status-error)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity={0.7}
          />
        )}
        {series.map((s, si) => {
          const pts: [number, number][] = s.data.map((v, i) => [
            PAD_L + i * stepX,
            yToPx(v),
          ]);
          const d = smooth ? smoothPath(pts) : `M ${pts.map((p) => p.join(",")).join(" L ")}`;
          const areaPath = `${d} L ${PAD_L + iw},${PAD_T + ih} L ${PAD_L},${PAD_T + ih} Z`;
          return (
            <g key={si}>
              {fill && <path d={areaPath} fill={s.color} opacity="0.15" />}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
        {hoveredIndex != null && (
          <line
            x1={PAD_L + hoveredIndex * stepX}
            x2={PAD_L + hoveredIndex * stepX}
            y1={PAD_T}
            y2={PAD_T + ih}
            stroke="var(--line-2)"
            strokeDasharray="3 3"
          />
        )}
        <rect
          data-testid="metric-chart-hitbox"
          x={PAD_L}
          y={PAD_T}
          width={iw}
          height={ih}
          fill="transparent"
          onMouseLeave={() => {
            setHoveredIndex(null);
            setTooltipPosition(null);
          }}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = event.clientX - rect.left;
            const nextIndex = clamp(Math.round((relativeX / rect.width) * Math.max(n - 1, 1)), 0, Math.max(n - 1, 0));
            setHoveredIndex(nextIndex);
            setTooltipPosition({ x: relativeX, y: event.clientY - rect.top });
          }}
        />
      </svg>
      {hoveredIndex != null && tooltipPosition && (
        <div
          className="pointer-events-none absolute z-10 min-w-[8rem] rounded-[3px] border border-line bg-bg-2 px-2.5 py-1.5 font-sans text-[12px] shadow-xl"
          style={{
            left: clamp(tooltipPosition.x + 12, 8, width - 180),
            top: clamp(tooltipPosition.y - 12, 8, height - 88),
          }}
        >
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">{tooltipLabel}</div>
          <div className="grid gap-1.5">
            {series.map((s, index) => (
              <div key={`${s.name ?? `series-${index}`}-${hoveredIndex}`} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-fg-1">
                  <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
                  {s.name ?? `Series ${index + 1}`}
                </span>
                <span className="font-mono text-fg tabular-nums">{valueFormatter(s.data[hoveredIndex] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
