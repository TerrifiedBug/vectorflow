import * as React from "react";
import { cn } from "@/lib/utils";

export type EventKind = "deploy" | "rollback" | "anomaly" | "alert" | "promote" | "note";

interface EventDotProps extends React.HTMLAttributes<HTMLDivElement> {
  kind: EventKind;
  size?: number;
}

const KIND_MAP: Record<EventKind, { glyph: string; color: string }> = {
  deploy: { glyph: "▲", color: "var(--node-transform)" },
  rollback: { glyph: "↺", color: "var(--status-error)" },
  anomaly: { glyph: "◆", color: "var(--status-degraded)" },
  alert: { glyph: "!", color: "var(--status-error)" },
  promote: { glyph: "⇡", color: "var(--accent-brand)" },
  note: { glyph: "·", color: "var(--fg-2)" },
};

export function EventDot({
  kind,
  size = 10,
  className,
  style,
  ...props
}: EventDotProps) {
  const { glyph, color } = KIND_MAP[kind];
  return (
    <div
      role="img"
      aria-label={`${kind} event`}
      className={cn(
        "inline-flex items-center justify-center rounded-full font-mono font-semibold shrink-0",
        className,
      )}
      style={{
        width: size + 6,
        height: size + 6,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid ${color}`,
        color,
        fontSize: size - 1,
        ...style,
      }}
      {...props}
    >
      {glyph}
    </div>
  );
}
