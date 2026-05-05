import * as React from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  fillOpacity?: number;
  strokeWidth?: number;
  className?: string;
}

export const Sparkline = React.memo(function Sparkline({
  data,
  width = 80,
  height = 22,
  color = "var(--accent-brand)",
  fill = true,
  fillOpacity = 0.18,
  strokeWidth = 1.4,
  className,
}: SparklineProps) {
  if (!data || data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / Math.max(data.length - 1, 1);
  const pts = data
    .map(
      (v, i) =>
        `${(i * stepX).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`,
    )
    .join(" ");
  const area = `0,${height} ${pts} ${width},${height}`;

  return (
    <svg
      width={width}
      height={height}
      className={className}
      style={{ display: "block" }}
      role="img"
      aria-label="trend"
    >
      {fill && <polygon points={area} fill={color} opacity={fillOpacity} />}
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
});
