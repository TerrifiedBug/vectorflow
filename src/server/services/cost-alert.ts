// src/server/services/cost-alert.ts
import { prisma } from "@/lib/prisma";
import type { AlertEvent } from "@/generated/prisma";
import { getCurrentMonthCostCents } from "@/server/services/cost-attribution";
import { deliverToChannels } from "@/server/services/channels";
import { deliverSingleWebhook } from "@/server/services/webhook-delivery";
import { trackWebhookDelivery } from "@/server/services/delivery-tracking";
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
          team: { select: { name: true } },
        },
      },
    },
  });

  for (const rule of rules) {
    const env = rule.environment;

    // Skip if no budget is configured
    if (env.costBudgetCents == null || env.costBudgetCents <= 0) continue;
    if (env.costPerGbCents === 0) continue;

    const currentCostCents = await getCurrentMonthCostCents(
      env.id,
      env.costPerGbCents
    );

    const exceeded = currentCostCents > env.costBudgetCents;

    // Check for existing firing alert
    const existingEvent = await prisma.alertEvent.findFirst({
      where: {
        alertRuleId: rule.id,
        status: "firing",
      },
      orderBy: { firedAt: "desc" },
    });

    if (exceeded && !existingEvent) {
      // Fire new alert
      const costDollars = (currentCostCents / 100).toFixed(2);
      const budgetDollars = (env.costBudgetCents / 100).toFixed(2);
      const message = `Monthly cost $${costDollars} exceeds budget $${budgetDollars}`;

      const event = await prisma.alertEvent.create({
        data: {
          alertRuleId: rule.id,
          status: "firing",
          value: currentCostCents,
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
  const channelLinks = await prisma.alertRuleChannel.findMany({
    where: { alertRuleId: rule.id },
    include: { channel: true },
  });

  if (channelLinks.length > 0) {
    const channels = channelLinks.map((cl) => cl.channel);
    await deliverToChannels(event.id, channels, payload);
  }

  // Deliver to webhooks
  const webhooks = await prisma.alertWebhook.findMany({
    where: { environmentId: rule.environmentId, enabled: true },
  });

  for (const webhook of webhooks) {
    await trackWebhookDelivery(
      event.id,
      webhook.id,
      webhook.url,
      () => deliverSingleWebhook(webhook, payload),
    );
  }
}
