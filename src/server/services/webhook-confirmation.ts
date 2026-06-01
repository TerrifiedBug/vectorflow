/**
 * Webhook destination one-time confirmation.
 *
 * A new (or URL-changed) `WebhookEndpoint` cannot deliver until an OWNER
 * of the owning organisation clicks a one-time confirmation link. Until
 * then `WebhookEndpoint.confirmedAt IS NULL` and `deliverOutboundWebhook`
 * short-circuits to a non-retryable failure.
 *
 * Plaintext token is returned once for emailing; only the SHA-256 hex
 * digest hits the DB. Single-use is enforced via `consumedAt: null`
 * predicate on the consuming `updateMany`, defeating the race window
 * between two parallel redeems.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma, adminPrisma } from "@/lib/prisma";

export const WEBHOOK_CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const TOKEN_BYTES = 32;

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface MintWebhookConfirmationResult {
  token: string;
  expiresAt: Date;
}

/**
 * Mint a one-time confirmation for `webhookEndpointId`. The plaintext token
 * is returned once and never persisted; embed it in a URL and mail to an
 * OWNER of the org.
 */
export async function mintWebhookConfirmation(opts: {
  webhookEndpointId: string;
  organizationId: string;
  requestedById?: string | null;
  now?: () => Date;
}): Promise<MintWebhookConfirmationResult> {
  const now = opts.now ?? (() => new Date());
  const plaintext = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(now().getTime() + WEBHOOK_CONFIRMATION_TTL_MS);

  await prisma.webhookConfirmation.create({
    data: {
      webhookEndpointId: opts.webhookEndpointId,
      organizationId: opts.organizationId,
      tokenHash,
      expiresAt,
      requestedById: opts.requestedById ?? null,
    },
  });

  return { token: plaintext, expiresAt };
}

export interface ConsumeWebhookConfirmationSuccess {
  ok: true;
  webhookEndpointId: string;
  organizationId: string;
}
export interface ConsumeWebhookConfirmationFailure {
  ok: false;
  reason: "not_found" | "expired" | "already_used";
}
export type ConsumeWebhookConfirmationResult =
  | ConsumeWebhookConfirmationSuccess
  | ConsumeWebhookConfirmationFailure;

/**
 * Redeem a confirmation token. On success flips
 * `WebhookEndpoint.confirmedAt = now()` AND marks the row consumed in
 * the same transaction.
 */
export async function consumeWebhookConfirmation(opts: {
  token: string;
  now?: () => Date;
}): Promise<ConsumeWebhookConfirmationResult> {
  const now = opts.now ?? (() => new Date());
  const tokenHash = hashToken(opts.token);

  // Token → org bootstrap: the confirmation link is clicked by an
  // unauthenticated user, so there is no org scope yet. The org is read from
  // the row inside. Keyed by the unguessable tokenHash, so it runs on the
  // admin connection (no extension → atomic multi-statement tx).
  return adminPrisma.$transaction(async (tx) => {
    const row = await tx.webhookConfirmation.findUnique({
      where: { tokenHash },
    });
    if (!row) return { ok: false, reason: "not_found" } as const;
    if (row.consumedAt) {
      return { ok: false, reason: "already_used" } as const;
    }
    if (row.expiresAt.getTime() < now().getTime()) {
      return { ok: false, reason: "expired" } as const;
    }

    const { count } = await tx.webhookConfirmation.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: now() },
    });
    if (count === 0) {
      return { ok: false, reason: "already_used" } as const;
    }

    await tx.webhookEndpoint.update({
      where: { id: row.webhookEndpointId },
      data: { confirmedAt: now() },
    });

    return {
      ok: true,
      webhookEndpointId: row.webhookEndpointId,
      organizationId: row.organizationId,
    };
  });
}

/**
 * Sweep expired-unconsumed + consumed-and-old confirmations. Same pattern
 * as the magic-link GC: keep consumed rows for 30 days so audit can answer
 * "when was webhook X confirmed and by whom".
 */
export async function gcExpiredWebhookConfirmations(
  now: () => Date = () => new Date(),
): Promise<number> {
  const cutoff30d = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000);
  // Fleet-wide GC across all orgs → admin connection.
  const { count } = await adminPrisma.webhookConfirmation.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now() }, consumedAt: null },
        { consumedAt: { lt: cutoff30d } },
      ],
    },
  });
  return count;
}
