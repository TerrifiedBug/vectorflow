import * as React from "react";

interface BarChartMiniProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export const BarChartMini = React.memo(function BarChartMini({
  data,
  width = 80,
  height = 22,
  color = "var(--accent-brand)",
  className,
}: BarChartMiniProps) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data) || 1;
  const bw = width / data.length;
  return (
    <svg
      width={width}
      height={height}
      className={className}
      style={{ display: "block" }}
      role="img"
      aria-label="distribution"
    >
      {data.map((v, i) => {
        const bh = (v / max) * (height - 2);
        return (
          <rect
            key={i}
            x={i * bw + 1}
            y={height - bh}
            width={bw - 2}
            height={bh}
            fill={color}
            opacity={0.4 + 0.6 * (v / max)}
            rx="1"
          />
        );
      })}
    </svg>
  );
});
