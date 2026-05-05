import * as React from "react";

interface StatusGridProps {
  /** 2D array of values 0..1, or -1 for missing */
  data: number[][];
  cellSize?: number;
  gap?: number;
  color?: string;
  className?: string;
}

export function StatusGrid({
  data,
  cellSize = 10,
  gap = 2,
  color = "var(--accent-brand)",
  className,
}: StatusGridProps) {
  if (!data || data.length === 0) return null;
  const cols = data[0].length;
  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gap,
      }}
    >
      {data.flatMap((row, r) =>
        row.map((v, c) => {
          const alpha = v < 0 ? 0 : Math.round(v * 0xff)
            .toString(16)
            .padStart(2, "0");
          const bg = v < 0 ? "var(--line-2)" : `${color}${alpha}`;
          return (
            <div
              key={`${r}-${c}`}
              style={{
                width: cellSize,
                height: cellSize,
                background: bg,
                borderRadius: 2,
              }}
            />
          );
        }),
      )}
    </div>
  );
}
