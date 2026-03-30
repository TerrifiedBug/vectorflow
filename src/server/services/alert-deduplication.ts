// src/server/services/alert-deduplication.ts
import { prisma } from "@/lib/prisma";
import type { AlertRule } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default cooldown period in minutes when not specified on the rule. */
export const DEFAULT_COOLDOWN_MINUTES = 15;

// ---------------------------------------------------------------------------
// shouldSuppressDuplicate
// ---------------------------------------------------------------------------

/**
 * Check whether a new alert event should be suppressed due to deduplication.
 *
 * An alert is considered a duplicate if the same rule + node combination had
 * a recently resolved event within the cooldown window. This prevents
 * flapping alerts from creating noise — if an alert fires, resolves, and
 * fires again within the cooldown, the second firing is suppressed.
 *
 * Note: this does NOT suppress when there is an *open* (firing/acknowledged)
 * event — that case is already handled by the evaluator's existing
 * open-event check.
 *
 * @returns true if the alert should be suppressed (do not fire)
 */
export async function shouldSuppressDuplicate(
  rule: AlertRule,
  nodeId: string,
  now: Date,
): Promise<boolean> {
  const cooldownMs =
    (rule.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) * 60 * 1000;
  const windowStart = new Date(now.getTime() - cooldownMs);

  // Look for a recently resolved event for this rule + node within the cooldown
  const recentResolvedEvent = await prisma.alertEvent.findFirst({
    where: {
      alertRuleId: rule.id,
      nodeId,
      status: "resolved",
      firedAt: { gte: windowStart },
    },
    orderBy: { firedAt: "desc" },
  });

  return recentResolvedEvent !== null;
}
