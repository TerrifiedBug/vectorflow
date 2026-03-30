/**
 * Shared badge color utilities. Single source of truth for all
 * compliance, status, and data-display badge styling.
 */

/** Compliance tag colors (PII, PHI, etc.) */
export function tagBadgeClass(tag: string): string {
  const upper = tag.toUpperCase();
  if (upper === "PII") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (upper === "PHI") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (upper === "PCI-DSS") return "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30";
  if (upper === "INTERNAL") return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
  if (upper === "PUBLIC") return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  return "bg-muted text-muted-foreground";
}

/** Pipeline process status badge colors */
export function statusBadgeClass(status: string): string {
  switch (status) {
    case "RUNNING": return "bg-status-healthy-bg text-status-healthy-foreground";
    case "CRASHED": return "bg-status-error-bg text-status-error-foreground";
    case "STOPPED": return "bg-status-neutral-bg text-status-neutral-foreground";
    case "STARTING":
    case "PENDING": return "bg-status-degraded-bg text-status-degraded-foreground";
    default: return "bg-muted text-muted-foreground";
  }
}

/** Reduction percentage badge color */
export function reductionBadgeClass(pct: number): string {
  if (pct > 50) return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  if (pct > 10) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

/** Certificate expiry status badge color */
export function certExpiryBadgeClass(daysUntilExpiry: number | null): string {
  if (daysUntilExpiry === null) return "bg-muted text-muted-foreground";
  if (daysUntilExpiry <= 0) return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (daysUntilExpiry <= 7) return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (daysUntilExpiry <= 30) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
}
