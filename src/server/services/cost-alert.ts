// src/server/services/cost-alert.ts
import { prisma } from "@/lib/prisma";
import type { AlertEvent } from "@/generated/prisma";
import { getCurrentMonthCostCents, getCurrentMonthGb } from "@/server/services/cost-attribution";
import { deliverToChannels } from "@/server/services/channels";
import type { ChannelPayload } from "@/server/services/channels/types";

interface CostAlertResult {
  event: AlertEvent;
  ruleId: string;
  environmentName: string;
}

/**
 * Evaluate cost budget alerts for all environments with cost_threshold_exceeded rules.
 * Called from FleetAlertService poll loop.
 */
export async function evaluateCostAlerts(): Promise<CostAlertResult[]> {
  const results: CostAlertResult[] = [];

  const rules = await prisma.alertRule.findMany({
    where: {
      enabled: true,
      metric: "cost_threshold_exceeded",
      AND: [
        {
          OR: [
            { snoozedUntil: null },
            { snoozedUntil: { lt: new Date() } },
          ],
        },
      ],
    },
    include: {
      environment: {
        select: {
          id: true,
          name: true,
          costPerGbCents: true,
          costBudgetCents: true,
          volumeBudgetGb: true,
          team: { select: { name: true } },
        },
      },
    },
  });

  for (const rule of rules) {
    const env = rule.environment;

    const hasCostBudget =
      env.costBudgetCents != null && env.costBudgetCents > 0 && env.costPerGbCents > 0;
    const hasVolumeBudget = env.volumeBudgetGb != null && env.volumeBudgetGb > 0;

    // Skip if neither a cost nor a volume budget is configured
    if (!hasCostBudget && !hasVolumeBudget) continue;

    let exceeded = false;
    let value = 0;
    let message = "";

    if (hasCostBudget && env.costBudgetCents != null) {
      const currentCostCents = await getCurrentMonthCostCents(env.id, env.costPerGbCents);
      if (currentCostCents > env.costBudgetCents) {
        exceeded = true;
        value = currentCostCents;
        message = `Monthly cost $${(currentCostCents / 100).toFixed(2)} exceeds budget $${(env.costBudgetCents / 100).toFixed(2)}`;
      }
    }

    // Volume budget is evaluated independently and fires even when no $-rate is
    // configured (the cost branch above is skipped when costPerGbCents = 0).
    if (!exceeded && hasVolumeBudget && env.volumeBudgetGb != null) {
      const currentGb = await getCurrentMonthGb(env.id);
      if (currentGb > env.volumeBudgetGb) {
        exceeded = true;
        value = currentGb; // AlertEvent.value is Float — keep the exact GB so it always reflects the breach
        message = `Monthly volume ${currentGb.toFixed(1)} GB exceeds budget ${env.volumeBudgetGb} GB`;
      }
    }

    // Check for existing firing alert
    const existingEvent = await prisma.alertEvent.findFirst({
      where: {
        alertRuleId: rule.id,
        status: "firing",
      },
      orderBy: { firedAt: "desc" },
    });

    if (exceeded && !existingEvent) {
      const event = await prisma.alertEvent.create({
        data: {
          alertRuleId: rule.id,
          status: "firing",
          value,
          message,
          firedAt: new Date(),
        },
      });

      results.push({
        event,
        ruleId: rule.id,
        environmentName: env.name,
      });

      // Deliver notifications
      await deliverCostAlertNotifications(rule, event, env, message);
    } else if (!exceeded && existingEvent) {
      // Resolve the alert
      await prisma.alertEvent.update({
        where: { id: existingEvent.id },
        data: { status: "resolved", resolvedAt: new Date() },
      });
    }
  }

  return results;
}

async function deliverCostAlertNotifications(
  rule: { id: string; name: string; environmentId: string },
  event: AlertEvent,
  env: { name: string; team: { name: string } | null },
  message: string
): Promise<void> {
  const payload: ChannelPayload = {
    alertId: event.id,
    status: "firing",
    ruleName: rule.name,
    severity: "warning",
    environment: env.name,
    team: env.team?.name,
    metric: "cost_threshold_exceeded",
    value: event.value,
    threshold: 0,
    message,
    timestamp: event.firedAt.toISOString(),
    dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/analytics/costs`,
  };

  // Deliver to notification channels
  await deliverToChannels(rule.environmentId, rule.id, payload, event.id);
}
