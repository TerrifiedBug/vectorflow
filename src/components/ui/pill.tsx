import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-1 font-mono uppercase tracking-[0.04em] rounded-[3px] border whitespace-nowrap leading-[1.4]",
  {
    variants: {
      variant: {
        status: "border-line-2 text-fg-1 bg-bg-2",
        ok: "border-accent-line text-accent-brand bg-accent-soft",
        warn:
          "text-status-degraded bg-[color:var(--status-degraded-bg)] border-[color:var(--status-degraded-bg)]",
        error:
          "text-status-error bg-[color:var(--status-error-bg)] border-[color:var(--status-error-bg)]",
        info:
          "text-status-info bg-[color:var(--status-info-bg)] border-[color:var(--status-info-bg)]",
        env: "border-line-2 text-fg-1 bg-bg-3",
        envProd: "border-accent-line text-accent-brand bg-accent-soft",
        kind: "border-line-2 text-fg-2 bg-bg-2",
        prose: "font-sans normal-case tracking-normal border-line-2 text-fg-1 bg-bg-2",
      },
      size: {
        xs: "text-[9px] px-1.5 py-px font-medium",
        sm: "text-[10px] px-1.5 py-0.5 font-medium",
        md: "text-[11px] px-2 py-0.5 font-medium",
      },
    },
    defaultVariants: { variant: "status", size: "sm" },
  },
);

export interface PillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof pillVariants> {
  /** Optional color override — produces a tinted bg + border + text. */
  color?: string;
}

export function Pill({
  className,
  variant,
  size,
  color,
  style,
  children,
  ...props
}: PillProps) {
  const colorStyle = color
    ? {
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 33%, transparent)`,
      }
    : undefined;
  return (
    <span
      className={cn(pillVariants({ variant, size }), className)}
      style={{ ...colorStyle, ...style }}
      {...props}
    >
      {children}
    </span>
  );
}
