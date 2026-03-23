import { cn } from "@/lib/utils";

type StatusVariant = "healthy" | "degraded" | "error" | "neutral" | "info";

const dotStyles: Record<StatusVariant, string> = {
  healthy: "bg-status-healthy",
  degraded: "bg-status-degraded",
  error: "bg-status-error",
  neutral: "bg-status-neutral",
  info: "bg-status-info",
};

const pulseStyles: Record<StatusVariant, string> = {
  healthy: "shadow-[0_0_0_0_var(--status-healthy)] animate-[status-pulse_2s_ease-in-out_infinite]",
  degraded: "shadow-[0_0_0_0_var(--status-degraded)] animate-[status-pulse_2s_ease-in-out_infinite]",
  error: "shadow-[0_0_0_0_var(--status-error)] animate-[status-pulse_1.5s_ease-in-out_infinite]",
  neutral: "",
  info: "",
};

interface StatusDotProps {
  variant: StatusVariant;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ variant, pulse = false, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        dotStyles[variant],
        pulse && pulseStyles[variant],
        className,
      )}
      aria-hidden="true"
    />
  );
}
