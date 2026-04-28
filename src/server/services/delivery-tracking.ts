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
  /** Optional notification channel ID for retry target resolution */
  channelId?: string;
  /** Attempt number (1 = first attempt, 2+ = retries). Defaults to 1. */
  attemptNumber?: number;
}

// ─── Backoff ────────────────────────────────────────────────────────────────

/** Backoff delays in seconds: attempt 1 → 30s, attempt 2 → 120s, attempt 3 → 600s */
export const BACKOFF_DELAYS = [30, 120, 600] as const;

/**
 * Returns the Date at which the next retry should be attempted, or null
 * if the attempt has exceeded the maximum retry count.
 */
export function getNextRetryAt(attemptNumber: number): Date | null {
  if (attemptNumber >= 1 && attemptNumber <= BACKOFF_DELAYS.length) {
    return new Date(Date.now() + BACKOFF_DELAYS[attemptNumber - 1] * 1000);
  }
  return null;
}

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Wraps a delivery call: creates a pending DeliveryAttempt, executes the
 * delivery function, then updates the record to success or failed.
 *
 * On failure, computes nextRetryAt from the backoff schedule so the
 * RetryService can pick it up later.
 *
 * Returns the DeliveryResult from the delivery function (or a synthesised
 * failure result when the function throws).
 */
export async function trackDelivery({
  alertEventId,
  channelType,
  channelName,
  deliverFn,
  channelId,
  attemptNumber = 1,
}: TrackDeliveryParams): Promise<DeliveryResult> {
  const attempt = await prisma.deliveryAttempt.create({
    data: {
      alertEventId,
      channelType,
      channelName,
      status: "pending",
      requestedAt: new Date(),
      channelId: channelId ?? null,
      attemptNumber,
    },
  });

  try {
    const result = await deliverFn();

    const nextRetryAt = result.success ? null : getNextRetryAt(attemptNumber);

    await prisma.deliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: result.success ? "success" : "failed",
        statusCode: result.statusCode ?? null,
        errorMessage: result.error ?? null,
        completedAt: new Date(),
        nextRetryAt,
      },
    });

    return result;
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown delivery error";

    const nextRetryAt = getNextRetryAt(attemptNumber);

    await prisma.deliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "failed",
        errorMessage,
        completedAt: new Date(),
        nextRetryAt,
      },
    });

    return { success: false, error: errorMessage };
  }
}

// ─── Convenience wrappers ───────────────────────────────────────────────────

/**
 * Track delivery for a notification channel.
 */
export function trackChannelDelivery(
  alertEventId: string,
  channelId: string,
  channelType: string,
  channelName: string,
  deliverFn: DeliveryFn,
  attemptNumber = 1,
): Promise<DeliveryResult> {
  return trackDelivery({
    alertEventId,
    channelType,
    channelName,
    deliverFn,
    channelId,
    attemptNumber,
  });
}
