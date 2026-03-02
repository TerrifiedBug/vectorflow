import { cn } from "@/lib/utils";

type StatusVariant = "healthy" | "degraded" | "error" | "neutral" | "info";

const dotStyles: Record<StatusVariant, string> = {
  healthy: "bg-status-healthy",
  degraded: "bg-status-degraded",
  error: "bg-status-error",
  neutral: "bg-status-neutral",
  info: "bg-status-info",
};

interface StatusDotProps {
  variant: StatusVariant;
  className?: string;
}

export function StatusDot({ variant, className }: StatusDotProps) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dotStyles[variant], className)}
      aria-hidden="true"
    />
  );
}
