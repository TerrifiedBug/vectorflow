import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export type DeliveryFn = () => Promise<DeliveryResult>;

export interface TrackDeliveryParams {
  alertEventId: string;
  channelType: string;
  channelName: string;
  deliverFn: DeliveryFn;
}

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Wraps a delivery call: creates a pending DeliveryAttempt, executes the
 * delivery function, then updates the record to success or failed.
 *
 * Returns the DeliveryResult from the delivery function (or a synthesised
 * failure result when the function throws).
 */
export async function trackDelivery({
  alertEventId,
  channelType,
  channelName,
  deliverFn,
}: TrackDeliveryParams): Promise<DeliveryResult> {
  const attempt = await prisma.deliveryAttempt.create({
    data: {
      alertEventId,
      channelType,
      channelName,
      status: "pending",
      requestedAt: new Date(),
    },
  });

  try {
    const result = await deliverFn();

    await prisma.deliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: result.success ? "success" : "failed",
        statusCode: result.statusCode ?? null,
        errorMessage: result.error ?? null,
        completedAt: new Date(),
      },
    });

    return result;
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown delivery error";

    await prisma.deliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      },
    });

    return { success: false, error: errorMessage };
  }
}

// ─── Convenience wrappers ───────────────────────────────────────────────────

/**
 * Track delivery for a legacy webhook (AlertWebhook).
 */
export function trackWebhookDelivery(
  alertEventId: string,
  webhookId: string,
  webhookName: string,
  deliverFn: DeliveryFn,
): Promise<DeliveryResult> {
  return trackDelivery({
    alertEventId,
    channelType: "legacy_webhook",
    channelName: webhookName,
    deliverFn,
  });
}

/**
 * Track delivery for a notification channel.
 */
export function trackChannelDelivery(
  alertEventId: string,
  channelId: string,
  channelType: string,
  channelName: string,
  deliverFn: DeliveryFn,
): Promise<DeliveryResult> {
  return trackDelivery({
    alertEventId,
    channelType,
    channelName,
    deliverFn,
  });
}
