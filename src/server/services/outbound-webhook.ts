import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/server/services/crypto";
import { validatePublicUrl } from "@/server/services/url-validation";
import { getNextRetryAt } from "@/server/services/delivery-tracking";
import type { AlertMetric } from "@/generated/prisma";
import { debugLog } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OutboundPayload {
  type: string;       // AlertMetric value
  timestamp: string;  // ISO-8601
  data: Record<string, unknown>;
}

export interface OutboundResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  isPermanent: boolean;
}

// Minimal endpoint shape needed for delivery (matches WebhookEndpoint Prisma model fields used here)
interface EndpointLike {
  id: string;
  url: string;
  encryptedSecret: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true if the result represents a permanent (non-retryable) failure.
 * 4xx non-429 HTTP responses and DNS/connection errors are permanent.
 */
export function isPermanentFailure(result: OutboundResult): boolean {
  if (result.statusCode !== undefined) {
    return result.statusCode >= 400 && result.statusCode < 500 && result.statusCode !== 429;
  }
  if (result.error) {
    return result.error.includes("ENOTFOUND") || result.error.includes("ECONNREFUSED");
  }
  return false;
}

// ─── Core delivery ──────────────────────────────────────────────────────────

/**
 * Delivers a POST request to a webhook endpoint using Standard-Webhooks signing.
 * Signing string: "{msgId}.{timestamp}.{body}"
 * Headers: webhook-id, webhook-timestamp, webhook-signature (v1,{base64})
 */
export async function deliverOutboundWebhook(
  endpoint: EndpointLike,
  payload: OutboundPayload,
): Promise<OutboundResult> {
  // SSRF protection
  try {
    await validatePublicUrl(endpoint.url);
  } catch {
    return { success: false, error: "SSRF: private IP", isPermanent: true };
  }

  const msgId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000); // integer seconds

  // Serialize body ONCE — same string used for signing AND as request body
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "webhook-id": msgId,
    "webhook-timestamp": String(timestamp),
  };

  // HMAC-SHA256 signing per Standard-Webhooks spec
  if (endpoint.encryptedSecret) {
    const secret = decrypt(endpoint.encryptedSecret);
    const signingString = `${msgId}.${timestamp}.${body}`;
    const sig = crypto
      .createHmac("sha256", secret)
      .update(signingString)
      .digest("base64");
    headers["webhook-signature"] = `v1,${sig}`;
  }

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      return { success: true, statusCode: res.status, isPermanent: false };
    }

    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    return {
      success: false,
      statusCode: res.status,
      error: `HTTP ${res.status}`,
      isPermanent: permanent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown delivery error";
    const permanent = message.includes("ENOTFOUND") || message.includes("ECONNREFUSED");
    return { success: false, error: message, isPermanent: permanent };
  }
}

// ─── Dispatch with tracking ──────────────────────────────────────────────────

/**
 * Creates a WebhookDelivery record, delivers to the endpoint, and updates
 * the record with the result. Permanent failures are set to "dead_letter"
 * (no nextRetryAt); retryable failures get a nextRetryAt from the backoff schedule.
 */
async function dispatchWithTracking(
  endpoint: EndpointLike,
  payload: OutboundPayload,
  metric: AlertMetric,
): Promise<void> {
  const msgId = crypto.randomUUID();

  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookEndpointId: endpoint.id,
      eventType: metric,
      msgId,
      payload: payload as object,
      status: "pending",
      attemptNumber: 1,
    },
  });

  const result = await deliverOutboundWebhook(endpoint, payload);

  if (result.success) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "success",
        statusCode: result.statusCode ?? null,
        completedAt: new Date(),
      },
    });
    return;
  }

  if (isPermanentFailure(result)) {
    // Permanent failure: dead_letter — retry service will not pick this up
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "dead_letter",
        statusCode: result.statusCode ?? null,
        errorMessage: result.error ?? null,
        nextRetryAt: null,
        completedAt: new Date(),
      },
    });
  } else {
    // Retryable failure: schedule next attempt
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "failed",
        statusCode: result.statusCode ?? null,
        errorMessage: result.error ?? null,
        nextRetryAt: getNextRetryAt(1),
        completedAt: new Date(),
      },
    });
  }
}

// ─── Public dispatch hook ────────────────────────────────────────────────────

/**
 * Queries enabled webhook endpoints subscribed to the given metric for the team,
 * then dispatches to each. Never throws — errors are logged.
 *
 * Call with: void fireOutboundWebhooks(...) — never await in critical path.
 */
export async function fireOutboundWebhooks(
  metric: AlertMetric,
  teamId: string,
  payload: OutboundPayload,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { teamId, enabled: true, eventTypes: { has: metric } },
  });

  if (endpoints.length === 0) return;

  for (const endpoint of endpoints) {
    try {
      await dispatchWithTracking(endpoint, payload, metric);
    } catch (err) {
      debugLog(
        "outbound-webhook",
        `Failed to dispatch webhook to endpoint ${endpoint.id}`,
        err,
      );
    }
  }
}
