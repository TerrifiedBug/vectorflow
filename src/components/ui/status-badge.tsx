import { cn } from "@/lib/utils";

type StatusVariant = "healthy" | "degraded" | "error" | "neutral" | "info";

const badgeStyles: Record<StatusVariant, string> = {
  healthy: "bg-status-healthy-bg text-status-healthy-foreground",
  degraded: "bg-status-degraded-bg text-status-degraded-foreground",
  error: "bg-status-error-bg text-status-error-foreground",
  neutral: "bg-status-neutral-bg text-status-neutral-foreground",
  info: "bg-status-info-bg text-status-info-foreground",
};

const dotColorStyles: Record<StatusVariant, string> = {
  healthy: "bg-status-healthy",
  degraded: "bg-status-degraded",
  error: "bg-status-error",
  neutral: "bg-status-neutral",
  info: "bg-status-info",
};

interface StatusBadgeProps {
  variant: StatusVariant;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        badgeStyles[variant],
        className
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotColorStyles[variant])}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}
