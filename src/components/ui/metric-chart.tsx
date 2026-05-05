import * as React from "react";

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
}: MetricChartProps) {
  const PAD_L = axis ? 38 : 4;
  const PAD_R = 4;
  const PAD_T = 6;
  const PAD_B = axis ? 18 : 4;
  const iw = width - PAD_L - PAD_R;
  const ih = height - PAD_T - PAD_B;
  const all = series.flatMap((s) => s.data);
  const min = 0;
  // Make sure the threshold line stays inside the plot area.
  const dataMax = Math.max(...all, thresholdY ?? 0) || 1;
  const max = dataMax * 1.08;
  const range = max - min;
  const n = series[0]?.data.length || 1;
  const stepX = iw / Math.max(n - 1, 1);
  const yToPx = (v: number) => PAD_T + ih - ((v - min) / range) * ih;

  return (
    <svg
      width={width}
      height={height}
      className={className}
      style={{ display: "block" }}
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
                fontSize="9"
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
        xLabels.map((l, i) => {
          const x = PAD_L + (iw * i) / Math.max(xLabels.length - 1, 1);
          return (
            <text
              key={i}
              x={x}
              y={height - 4}
              fill="var(--fg-2)"
              fontSize="9"
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              {l}
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
        const d = smooth
          ? smoothPath(pts)
          : `M ${pts.map((p) => p.join(",")).join(" L ")}`;
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
    </svg>
  );
}
