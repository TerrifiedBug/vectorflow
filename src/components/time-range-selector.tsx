"use client";

import { cn } from "@/lib/utils";

const DEFAULT_RANGES = ["1h", "6h", "1d", "7d", "30d"] as const;

interface TimeRangeSelectorProps<T extends string = string> {
  /** The available range values to display as toggle buttons */
  ranges?: readonly T[];
  /** The currently selected range value */
  value: T;
  /** Callback when a range is selected */
  onChange: (value: T) => void;
  /** Optional additional className for the container */
  className?: string;
}

export function TimeRangeSelector<T extends string = string>({
  ranges,
  value,
  onChange,
  className,
}: TimeRangeSelectorProps<T>) {
  const displayRanges = (ranges ?? DEFAULT_RANGES) as readonly T[];

  return (
    <div className={cn("flex items-center gap-1", className)} role="group" aria-label="Time range">
      {displayRanges.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
            value === v
              ? "bg-accent text-accent-foreground border-transparent"
              : "bg-transparent text-muted-foreground border-border hover:bg-muted",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
