import * as React from "react";
import { cn } from "@/lib/utils";

interface KpiTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  accent?: string;
  bordered?: boolean;
  trend?: React.ReactNode;
}

export function KpiTile({
  label,
  value,
  unit,
  sub,
  accent,
  bordered = true,
  trend,
  className,
  style,
  ...props
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col p-4",
        bordered &&
          "bg-bg-2 border border-line rounded-md",
        className,
      )}
      style={style}
      {...props}
    >
      <div className="font-mono text-fg-2 uppercase tracking-[0.05em]" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-2">
        <span
          className="font-mono font-medium tracking-[-0.02em]"
          style={{
            fontSize: 26,
            color: accent ?? "var(--fg)",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {unit && (
          <span className="font-mono text-fg-2" style={{ fontSize: 12 }}>
            {unit}
          </span>
        )}
      </div>
      {(sub || trend) && (
        <div className="flex items-center justify-between mt-2">
          {sub && (
            <span
              className="font-mono text-fg-2"
              style={{ fontSize: 11 }}
            >
              {sub}
            </span>
          )}
          {trend}
        </div>
      )}
    </div>
  );
}

export function KpiStrip({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex border-b border-line bg-bg-1 [&>div]:flex-1 [&>div:not(:last-child)]:border-r [&>div:not(:last-child)]:border-line",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function KpiInStrip({
  label,
  value,
  unit,
  sub,
  accent,
  className,
  ...props
}: KpiTileProps) {
  return (
    <div className={cn("p-4", className)} {...props}>
      <div className="font-mono text-fg-2 uppercase tracking-[0.05em]" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1 mt-1.5">
        <span
          className="font-mono font-medium"
          style={{ fontSize: 26, color: accent ?? "var(--fg)", lineHeight: 1 }}
        >
          {value}
        </span>
        {unit && (
          <span className="font-mono text-fg-2" style={{ fontSize: 12 }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div
          className="font-mono text-fg-2 mt-1.5"
          style={{ fontSize: 11 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
