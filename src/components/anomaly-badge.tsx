"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AnomalyBadgeProps {
  count: number;
  severity: string; // "info" | "warning" | "critical"
  className?: string;
  /** When provided, the badge becomes a clickable link to this URL */
  href?: string;
}

// ─── Severity styling ───────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  warning:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  critical:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const SEVERITY_LABELS: Record<string, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Displays a warning badge indicating the number and severity of
 * active anomaly events for a pipeline.
 *
 * Usage:
 * ```tsx
 * <AnomalyBadge count={3} severity="warning" />
 * <AnomalyBadge count={3} severity="warning" href="/alerts?tab=anomalies" />
 * ```
 */
export function AnomalyBadge({ count, severity, className, href }: AnomalyBadgeProps) {
  if (count === 0) return null;

  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  const label = SEVERITY_LABELS[severity] ?? "Unknown";

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-transparent",
        href ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default",
        style,
        className,
      )}
      aria-label={`${count} ${label.toLowerCase()} anomalies detected`}
    >
      <AlertTriangle className="size-3" />
      {count}
    </Badge>
  );

  const tooltipContent = (
    <p>
      {count} {label.toLowerCase()} anomal{count === 1 ? "y" : "ies"} detected
      {href ? " — click to view" : ""}
    </p>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {href ? (
            <Link href={href} onClick={(e) => e.stopPropagation()}>
              {badge}
            </Link>
          ) : (
            badge
          )}
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
