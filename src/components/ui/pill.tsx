import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-1 font-mono uppercase tracking-[0.06em] rounded-[3px] border whitespace-nowrap leading-none",
  {
    variants: {
      variant: {
        status: "border-line-2 text-fg-1 bg-bg-2",
        ok: "border-accent-line text-accent-brand bg-accent-soft",
        warn:
          "text-status-degraded bg-status-degraded-bg border-[color:color-mix(in_srgb,var(--status-degraded)_35%,transparent)]",
        error:
          "text-status-error bg-status-error-bg border-[color:color-mix(in_srgb,var(--status-error)_35%,transparent)]",
        info:
          "text-status-info bg-status-info-bg border-[color:color-mix(in_srgb,var(--status-info)_35%,transparent)]",
        env: "border-line-2 text-fg-1 bg-bg-3",
        envProd: "border-accent-line text-accent-brand bg-accent-soft",
        kind: "border-line-2 text-fg-2 bg-bg-2",
        prose: "font-sans normal-case tracking-normal leading-[1.35] border-line-2 text-fg-1 bg-bg-2",
      },
      size: {
        xs: "text-[11px] px-1.5 py-1 font-medium",
        sm: "text-[11px] px-1.5 py-1 font-medium",
        md: "text-[11px] px-2 py-1 font-medium",
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
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 34%, transparent)`,
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
