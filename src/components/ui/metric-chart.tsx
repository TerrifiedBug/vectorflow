import * as React from "react";

export interface MetricChartSeries {
  name?: string;
  color: string;
  data: number[];
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
}: MetricChartProps) {
  const PAD_L = axis ? 38 : 4;
  const PAD_R = 4;
  const PAD_T = 6;
  const PAD_B = axis ? 18 : 4;
  const iw = width - PAD_L - PAD_R;
  const ih = height - PAD_T - PAD_B;
  const all = series.flatMap((s) => s.data);
  const min = 0;
  const max = (Math.max(...all) || 1) * 1.08;
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
