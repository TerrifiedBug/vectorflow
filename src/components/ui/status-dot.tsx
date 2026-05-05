import { cn } from "@/lib/utils";

type StatusVariant = "healthy" | "degraded" | "error" | "neutral" | "info" | "idle";

const dotStyles: Record<StatusVariant, string> = {
  healthy: "bg-status-healthy",
  degraded: "bg-status-degraded",
  error: "bg-status-error",
  neutral: "bg-status-neutral",
  info: "bg-status-info",
  idle: "bg-fg-2",
};

const pulseStyles: Record<StatusVariant, string> = {
  healthy:
    "shadow-[0_0_0_0_var(--status-healthy)] animate-[status-pulse_2s_ease-in-out_infinite]",
  degraded:
    "shadow-[0_0_0_0_var(--status-degraded)] animate-[status-pulse_2s_ease-in-out_infinite]",
  error:
    "shadow-[0_0_0_0_var(--status-error)] animate-[status-pulse_1.5s_ease-in-out_infinite]",
  neutral: "",
  info: "",
  idle: "",
};

const haloStyles: Record<StatusVariant, string> = {
  healthy: "shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-healthy)_22%,transparent)]",
  degraded: "shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-degraded)_22%,transparent)]",
  error: "shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-error)_22%,transparent)]",
  neutral: "",
  info: "shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-info)_22%,transparent)]",
  idle: "",
};

interface StatusDotProps {
  variant: StatusVariant;
  pulse?: boolean;
  halo?: boolean;
  size?: number;
  className?: string;
  label?: string;
}

export function StatusDot({
  variant,
  pulse = false,
  halo = true,
  size = 6,
  className,
  label,
}: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full transition-colors duration-300",
        dotStyles[variant],
        pulse && pulseStyles[variant],
        halo && haloStyles[variant],
        className,
      )}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
