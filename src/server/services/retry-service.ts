import { prisma } from "@/lib/prisma";
import {
  trackWebhookDelivery,
  trackChannelDelivery,
  getNextRetryAt,
} from "@/server/services/delivery-tracking";
import {
  deliverSingleWebhook,
  type WebhookPayload,
} from "@/server/services/webhook-delivery";
import { getDriver } from "@/server/services/channels";
import { deliverOutboundWebhook, isPermanentFailure } from "@/server/services/outbound-webhook";

// ─── Constants ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPT_NUMBER = 3;

// ─── RetryService ───────────────────────────────────────────────────────────

export class RetryService {
  private timer: ReturnType<typeof setInterval> | null = null;

  init(): void {
    console.log("[retry-service] Initializing delivery retry service");
    this.start();
  }

  start(): void {
    this.timer = setInterval(
      this.processRetries.bind(this),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();
    console.log(
      `[retry-service] Poll loop started (every ${POLL_INTERVAL_MS / 1000}s)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[retry-service] Poll loop stopped");
    }
  }

  /**
   * Core poll loop: finds due retries and re-executes them.
   *
   * Each failed DeliveryAttempt with a non-null nextRetryAt in the past
   * and attemptNumber < 4 is eligible. The original record's nextRetryAt
   * is nulled (claimed) and a NEW DeliveryAttempt is created via the
   * tracking wrappers, which handle backoff scheduling automatically.
   */
  async processRetries(): Promise<void> {
    let dueRetries;
    try {
      dueRetries = await prisma.deliveryAttempt.findMany({
        where: {
          status: "failed",
          nextRetryAt: { lte: new Date() },
          attemptNumber: { lt: MAX_ATTEMPT_NUMBER + 1 },
        },
        orderBy: { nextRetryAt: "asc" },
        take: BATCH_SIZE,
      });
    } catch (err) {
      console.error("[retry-service] Error querying due retries:", err);
      return;
    }

    if (dueRetries.length === 0) return;

    console.log(
      `[retry-service] Found ${dueRetries.length} due retr${dueRetries.length === 1 ? "y" : "ies"}`,
    );

    for (const attempt of dueRetries) {
      try {
        // Claim: null out nextRetryAt so another poll cycle won't re-pick it
        await prisma.deliveryAttempt.update({
          where: { id: attempt.id },
          data: { nextRetryAt: null },
        });

        // Reconstruct the payload from the AlertEvent + AlertRule
        const payload = await this.buildPayload(attempt.alertEventId);
        if (!payload) {
          console.error(
            `[retry-service] Cannot build payload for alertEvent=${attempt.alertEventId} — skipping retry`,
          );
          continue;
        }

        const nextAttemptNumber = attempt.attemptNumber + 1;

        // Re-execute based on delivery target type
        if (attempt.webhookId) {
          await this.retryWebhook(
            attempt.webhookId,
            attempt.alertEventId,
            payload,
            nextAttemptNumber,
          );
        } else if (attempt.channelId) {
          await this.retryChannel(
            attempt.channelId,
            attempt.alertEventId,
            payload,
            nextAttemptNumber,
          );
        } else {
          console.error(
            `[retry-service] Attempt ${attempt.id} has no webhookId or channelId — skipping`,
          );
        }
      } catch (err) {
        // Individual retry errors must never crash the poll loop
        console.error(
          `[retry-service] Error retrying attempt ${attempt.id}:`,
          err,
        );
      }
    }

    // Also process outbound webhook retries
    await this.processOutboundRetries();
  }

  /**
   * Retry loop for outbound webhook deliveries (WebhookDelivery model).
   * Separate from alert delivery retries to avoid coupling.
   * IMPORTANT: Only queries status: "failed" — dead_letter records are NEVER retried.
   */
  async processOutboundRetries(): Promise<void> {
    let dueRetries;
    try {
      dueRetries = await prisma.webhookDelivery.findMany({
        where: {
          status: "failed",
          nextRetryAt: { lte: new Date() },
          attemptNumber: { lt: MAX_ATTEMPT_NUMBER + 1 },
        },
        include: {
          webhookEndpoint: { select: { url: true, encryptedSecret: true, enabled: true } },
        },
        orderBy: { nextRetryAt: "asc" },
        take: BATCH_SIZE,
      });
    } catch (err) {
      console.error("[retry-service] Error querying outbound webhook retries:", err);
      return;
    }

    if (dueRetries.length === 0) return;

    console.log(
      `[retry-service] Found ${dueRetries.length} outbound webhook retr${dueRetries.length === 1 ? "y" : "ies"}`,
    );

    for (const delivery of dueRetries) {
      try {
        // Claim: null out nextRetryAt so another poll cycle won't re-pick it
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { nextRetryAt: null },
        });

        // Skip if endpoint was disabled or deleted
        if (!delivery.webhookEndpoint || !delivery.webhookEndpoint.enabled) {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: "dead_letter", completedAt: new Date() },
          });
          continue;
        }

        const nextAttemptNumber = delivery.attemptNumber + 1;
        const result = await deliverOutboundWebhook(
          {
            url: delivery.webhookEndpoint.url,
            encryptedSecret: delivery.webhookEndpoint.encryptedSecret,
            id: delivery.webhookEndpointId,
          },
          delivery.payload as { type: string; timestamp: string; data: Record<string, unknown> },
        );

        if (result.success) {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "success",
              statusCode: result.statusCode,
              attemptNumber: nextAttemptNumber,
              completedAt: new Date(),
            },
          });
          console.log(
            `[retry-service] Outbound webhook retry succeeded (delivery=${delivery.id}, attempt=${nextAttemptNumber})`,
          );
        } else if (isPermanentFailure(result)) {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "dead_letter",
              statusCode: result.statusCode,
              errorMessage: result.error,
              attemptNumber: nextAttemptNumber,
              completedAt: new Date(),
            },
          });
          console.log(
            `[retry-service] Outbound webhook dead-lettered (delivery=${delivery.id}): ${result.error}`,
          );
        } else {
          const nextRetryAt = getNextRetryAt(nextAttemptNumber);
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "failed",
              statusCode: result.statusCode,
              errorMessage: result.error,
              attemptNumber: nextAttemptNumber,
              nextRetryAt,
            },
          });
          console.log(
            `[retry-service] Outbound webhook retry failed (delivery=${delivery.id}, attempt=${nextAttemptNumber}): ${result.error}`,
          );
        }
      } catch (err) {
        console.error(`[retry-service] Error retrying outbound delivery ${delivery.id}:`, err);
      }
    }
  }

  /**
   * Reconstruct a WebhookPayload from an AlertEvent and its AlertRule.
   * Returns null if the event or rule has been deleted.
   */
  private async buildPayload(
    alertEventId: string,
  ): Promise<WebhookPayload | null> {
    const event = await prisma.alertEvent.findUnique({
      where: { id: alertEventId },
      include: {
        alertRule: {
          include: {
            environment: {
              select: { name: true, team: { select: { name: true } } },
            },
            pipeline: { select: { name: true } },
          },
        },
        node: { select: { host: true } },
      },
    });

    if (!event || !event.alertRule) return null;

    const rule = event.alertRule;

    return {
      alertId: event.id,
      status: event.status === "resolved" ? "resolved" : "firing",
      ruleName: rule.name,
      severity: "warning",
      environment: rule.environment.name,
      team: rule.environment.team?.name,
      node: event.node?.host ?? undefined,
      pipeline: rule.pipeline?.name ?? undefined,
      metric: rule.metric,
      value: event.value,
      threshold: rule.threshold ?? 0,
      message: event.message ?? "",
      timestamp: event.firedAt.toISOString(),
      dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
    };
  }

  /**
   * Retry a legacy webhook delivery.
   */
  private async retryWebhook(
    webhookId: string,
    alertEventId: string,
    payload: WebhookPayload,
    attemptNumber: number,
  ): Promise<void> {
    const webhook = await prisma.alertWebhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      console.error(
        `[retry-service] Webhook ${webhookId} not found — skipping retry`,
      );
      return;
    }

    const result = await trackWebhookDelivery(
      alertEventId,
      webhookId,
      webhook.url,
      () => deliverSingleWebhook(webhook, payload),
      attemptNumber,
    );

    if (result.success) {
      console.log(
        `[retry-service] Webhook retry succeeded (webhook=${webhookId}, attempt=${attemptNumber})`,
      );
    } else {
      console.log(
        `[retry-service] Webhook retry failed (webhook=${webhookId}, attempt=${attemptNumber}): ${result.error}`,
      );
    }
  }

  /**
   * Retry a notification channel delivery.
   */
  private async retryChannel(
    channelId: string,
    alertEventId: string,
    payload: WebhookPayload,
    attemptNumber: number,
  ): Promise<void> {
    const channel = await prisma.notificationChannel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      console.error(
        `[retry-service] Channel ${channelId} not found — skipping retry`,
      );
      return;
    }

    const result = await trackChannelDelivery(
      alertEventId,
      channelId,
      channel.type,
      channel.name,
      async () => {
        const driver = getDriver(channel.type);
        const driverResult = await driver.deliver(
          channel.config as Record<string, unknown>,
          payload,
        );
        return { success: driverResult.success, error: driverResult.error };
      },
      attemptNumber,
    );

    if (result.success) {
      console.log(
        `[retry-service] Channel retry succeeded (channel=${channelId}, attempt=${attemptNumber})`,
      );
    } else {
      console.log(
        `[retry-service] Channel retry failed (channel=${channelId}, attempt=${attemptNumber}): ${result.error}`,
      );
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const retryService = new RetryService();

export function initRetryService(): void {
  retryService.init();
}
