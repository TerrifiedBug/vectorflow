import { prisma } from "@/lib/prisma";
import type { AlertMetric } from "@/generated/prisma";
import { deliverToChannels } from "@/server/services/channels";
import { deliverWebhooks } from "@/server/services/webhook-delivery";

// Re-export from the shared (client-safe) module so existing server imports
// continue to work without changes.
export { EVENT_METRICS, isEventMetric } from "@/lib/alert-metrics";

// ---------------------------------------------------------------------------
// Fire an event-based alert
// ---------------------------------------------------------------------------

/**
 * Fire an event-based alert inline at the source of the event.
 *
 * Queries active AlertRule entries matching the metric and environment,
 * creates AlertEvent records, and delivers notifications through the
 * configured channels.
 *
 * Errors are logged but never thrown — alert failures must not break the
 * calling operation.
 */
export async function fireEventAlert(
  metric: AlertMetric,
  environmentId: string,
  metadata: {
    message: string;
    nodeId?: string;
    pipelineId?: string;
    [key: string]: unknown;
  },
): Promise<void> {
  try {
    // 1. Query active AlertRule entries matching the metric + environment
    const rules = await prisma.alertRule.findMany({
      where: {
        environmentId,
        metric,
        enabled: true,
        ...(metadata.pipelineId
          ? {
              OR: [
                { pipelineId: metadata.pipelineId as string },
                { pipelineId: null },
              ],
            }
          : {}),
      },
      include: {
        pipeline: { select: { name: true } },
        environment: {
          select: { name: true, team: { select: { name: true } } },
        },
      },
    });

    if (rules.length === 0) return;

    for (const rule of rules) {
      try {
        // 2. Create an AlertEvent record
        const event = await prisma.alertEvent.create({
          data: {
            alertRuleId: rule.id,
            nodeId: (metadata.nodeId as string) ?? null,
            status: "firing",
            value: 0,
            message: metadata.message,
          },
        });

        // 3. Build the channel payload
        const payload = {
          alertId: event.id,
          status: "firing" as const,
          ruleName: rule.name,
          severity: "warning",
          environment: rule.environment.name,
          team: rule.environment.team?.name,
          node: (metadata.nodeId as string) ?? undefined,
          pipeline: rule.pipeline?.name ?? undefined,
          metric: rule.metric,
          value: 0,
          threshold: rule.threshold ?? 0,
          message: metadata.message,
          timestamp: event.firedAt.toISOString(),
          dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
        };

        // 4. Deliver to legacy webhooks and notification channels
        await deliverWebhooks(rule.environmentId, payload);
        await deliverToChannels(rule.environmentId, rule.id, payload);

        // 5. Update the AlertEvent with notifiedAt timestamp
        await prisma.alertEvent.update({
          where: { id: event.id },
          data: { notifiedAt: new Date() },
        });
      } catch (ruleErr) {
        // Per-rule isolation: one rule's delivery failure must not
        // prevent other rules from being processed.
        console.error(
          `fireEventAlert delivery error (rule=${rule.id}, metric=${metric}):`,
          ruleErr,
        );
      }
    }
  } catch (err) {
    console.error(
      `fireEventAlert error (metric=${metric}, env=${environmentId}):`,
      err,
    );
  }
}

// TODO: certificate_expiring — no existing certificate expiry check exists.
// Certificates are stored as encrypted PEM blobs without parsed expiry metadata.
// To implement: add a periodic job that parses the PEM notAfter date from each
// Certificate record and fires fireEventAlert("certificate_expiring", ...) when
// a certificate is within N days of expiration.
