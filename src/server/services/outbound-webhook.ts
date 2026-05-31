import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import {
  decryptForOrgOrFallback,
  loadOrgDataKeyCiphertext,
} from "@/server/services/crypto-v3-callsite";
import { validateOutboundUrl } from "@/server/services/url-validation";
import { getNextRetryAt } from "@/server/services/delivery-tracking";
import type { AlertMetric } from "@/generated/prisma";
import { debugLog } from "@/lib/logger";
import {
  DnsRebindingError,
  WebhookRedirectError,
  fetchHardened,
} from "@/server/services/webhook-hardened-delivery";
import { isDemoMode } from "@/lib/is-demo-mode";

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
  /**
   * Org that owns the WebhookEndpoint row. Required to route the v3
   * envelope-decrypt to the correct DEK. Callers MUST select
   * `organizationId` on the WebhookEndpoint row they pass in.
   */
  organizationId: string;
  /**
   * Timestamp of the most recent successful one-time
   * confirmation, or null/undefined when the endpoint has been created /
   * had its URL changed but the confirmation flow has not completed.
   * Delivery FAILS CLOSED when this is null OR undefined.
   *
   * Callers that load the endpoint from the DB MUST include `confirmedAt`
   * in their `select` (the retry-service and `webhookEndpoint.testDelivery`
   * paths thread it through). The migration backfills existing rows with
   * `NOW()` so the rollout doesn't break previously-working webhooks.
   */
  confirmedAt?: Date | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true if the result represents a permanent (non-retryable) failure.
 * 4xx non-429 HTTP responses and DNS/connection errors are permanent. The
 * caller-supplied `isPermanent` flag is the OTHER trigger —
 * `fetchHardened` errors (redirect cap, protocol downgrade, DNS rebinding)
 * set `isPermanent: true` directly without a status code, and the retry
 * loop MUST honour that signal to dead-letter rather than reschedule.
 */
export function isPermanentFailure(result: OutboundResult): boolean {
  if (result.isPermanent) return true;
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
  msgId = crypto.randomUUID(),
): Promise<OutboundResult> {
  // Demo mode: never make outbound HTTP calls. Return a non-retryable
  // success-shaped result so the delivery record settles cleanly.
  if (isDemoMode()) {
    debugLog("outbound-webhook", `Demo mode: skipping delivery to ${endpoint.url}`);
    return { success: true, statusCode: 200, isPermanent: false };
  }

  // Refuse delivery to an unconfirmed destination. Loose equality
  // catches BOTH `null` (explicit) and `undefined` (callers that don't
  // include `confirmedAt` in their select). All in-tree callers now thread
  // `confirmedAt` through; this is the fail-closed guarantee for any future
  // call site that forgets to.
  if (endpoint.confirmedAt == null) {
    return {
      success: false,
      error: "Webhook destination has not been confirmed",
      isPermanent: true,
    };
  }

  // SSRF protection. Customer-controlled destination — force the policy even
  // in OSS so a malicious / mistyped webhook URL can't be used to hit private
  // IPs, cloud metadata, or .internal TLDs. `validateOutboundUrl` is the
  // unified policy site shared with AI providers, vault, context7, etc.
  try {
    await validateOutboundUrl(endpoint.url, { force: true });
  } catch {
    return { success: false, error: "SSRF: private IP", isPermanent: true };
  }

  const timestamp = Math.floor(Date.now() / 1000); // integer seconds

  // Serialize body ONCE — same string used for signing AND as request body
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "webhook-id": msgId,
    "webhook-timestamp": String(timestamp),
  };

  // HMAC-SHA256 signing per Standard-Webhooks spec. The endpoint
  // ciphertext is routed through the v3-or-v2 wrapper so orgs with a
  // provisioned DEK envelope-decrypt while OSS / self-hosted stays on v2.
  if (endpoint.encryptedSecret) {
    const dataKeyCiphertext = await loadOrgDataKeyCiphertext(endpoint.organizationId);
    const secret = await decryptForOrgOrFallback(endpoint.encryptedSecret, {
      orgId: endpoint.organizationId,
      dataKeyCiphertext,
      domain: ENCRYPTION_DOMAINS.GENERIC,
      rowTable: "WebhookEndpoint",
      rowId: endpoint.id,
    });
    const signingString = `${msgId}.${timestamp}.${body}`;
    const sig = crypto
      .createHmac("sha256", secret)
      .update(signingString)
      .digest("base64");
    headers["webhook-signature"] = `v1,${sig}`;
  }

  try {
    // `fetchHardened` adds (a) max 3 redirect hops with per-hop
    // SSRF + scheme re-validation, (b) DNS rebinding mitigation via a
    // 30s cache of public IPs, (c) protocol-downgrade rejection. The
    // signing already-happened above against the original URL; redirects
    // re-issue the same body + signature.
    const res = await fetchHardened(endpoint.url, {
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
    if (
      err instanceof WebhookRedirectError ||
      err instanceof DnsRebindingError
    ) {
      // Redirect cap exceeded, protocol downgrade, DNS-no-answer, or
      // split-answer rebinding — all non-retryable; the destination is
      // misbehaving and no amount of retrying will change that.
      return { success: false, error: err.message, isPermanent: true };
    }
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

  const result = await deliverOutboundWebhook(endpoint, payload, msgId);

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
