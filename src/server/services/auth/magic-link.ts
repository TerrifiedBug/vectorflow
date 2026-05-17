/**
 * Magic-link sign-in service (plan §8 / Phase 5y).
 *
 * Cloud-default authentication for new orgs is "SSO or magic link". This
 * module mints a one-time random token, persists only its SHA-256 hash,
 * mails the plaintext to the user, and consumes it on redeem. The
 * NextAuth Credentials provider (added in a follow-up) calls
 * `consumeMagicLink` and creates a session if it returns `ok`.
 *
 * Security properties:
 *
 *   - **Plaintext token is never persisted.** Only the SHA-256 hex digest
 *     hits the DB. A stolen DB snapshot cannot replay the token without
 *     also intercepting the email.
 *
 *   - **Single-use.** `consumeMagicLink` sets `consumedAt` inside the same
 *     transaction it reads the row; a second redeem of the same token
 *     fails the not-yet-consumed predicate. The atomic update form
 *     defeats both replay AND the (slim) window where two parallel
 *     redeems could each pass a stale "consumedAt IS NULL" read.
 *
 *   - **TTL.** Default 10 minutes — long enough for a slow mail relay but
 *     short enough that a stolen link is useless within a workday.
 *
 *   - **SSO-precedence.** When the resolved organisation has OIDC
 *     configured, `mintMagicLink` refuses to issue a token. The plan
 *     calls this out explicitly: SSO-only orgs cannot have local
 *     credential fallbacks.
 *
 *   - **Per-org isolation.** Each token row references an
 *     `Organization.id`. A token minted on `org-a.example` cannot
 *     authenticate on `org-b.example` because the redeem endpoint
 *     compares the request's resolved org with `token.organizationId`.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/org-settings";

export const MAGIC_LINK_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_BYTES = 32; // 256 bits — base64url is 43 chars

export interface MintMagicLinkResult {
  token: string;
  expiresAt: Date;
}

export class MagicLinkSsoOnlyError extends Error {
  readonly _tag = "MagicLinkSsoOnlyError" as const;
  constructor(public readonly organizationId: string) {
    super(`organization ${organizationId} is SSO-only; magic links are disabled`);
    this.name = "MagicLinkSsoOnlyError";
  }
}

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generateTokenPlaintext(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Mint a fresh magic-link token for `email` within `organizationId`. The
 * plaintext token is returned ONCE and never persisted — the caller's
 * responsibility is to embed it in a URL and mail it. Throws
 * `MagicLinkSsoOnlyError` if the org has OIDC configured.
 */
export async function mintMagicLink(opts: {
  organizationId: string;
  email: string;
  requestIp?: string;
  /** Override `Date.now` for tests. */
  now?: () => Date;
}): Promise<MintMagicLinkResult> {
  const now = opts.now ?? (() => new Date());

  // SSO precedence — refuse to mint local credentials when the org is
  // SSO-only. We don't load OrganizationSettings inside a transaction
  // because we don't need to: a misconfigured race (admin disables SSO
  // between this check and the create) is harmless — a magic link is
  // already a low-trust artefact.
  const settings = await getOrgSettings(opts.organizationId);
  if (settings?.oidcIssuer && settings?.oidcClientId) {
    throw new MagicLinkSsoOnlyError(opts.organizationId);
  }

  const plaintext = generateTokenPlaintext();
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(now().getTime() + MAGIC_LINK_TTL_MS);

  await prisma.magicLinkToken.create({
    data: {
      organizationId: opts.organizationId,
      email: opts.email.toLowerCase().trim(),
      tokenHash,
      expiresAt,
      requestIp: opts.requestIp ?? null,
    },
  });

  return { token: plaintext, expiresAt };
}

export interface ConsumeMagicLinkSuccess {
  ok: true;
  organizationId: string;
  email: string;
}
export interface ConsumeMagicLinkFailure {
  ok: false;
  reason:
    | "not_found"
    | "expired"
    | "already_used"
    | "wrong_organization";
}
export type ConsumeMagicLinkResult =
  | ConsumeMagicLinkSuccess
  | ConsumeMagicLinkFailure;

/**
 * Redeem a magic-link token. On success returns the org + email so the
 * caller can create or look up a User and mint a session. On failure
 * returns a structured reason — the redeem route maps these to a
 * generic "this link is invalid" message (no info leakage about whether
 * the token expired vs never existed).
 *
 * When `expectedOrganizationId` is supplied, the redeem must occur from
 * the same org context the link was minted in — the host derives the
 * expected org (plan §8) and we compare here so a link captured from
 * org A and redeemed on org B's subdomain fails.
 */
export async function consumeMagicLink(opts: {
  token: string;
  expectedOrganizationId?: string;
  /** Override `Date.now` for tests. */
  now?: () => Date;
}): Promise<ConsumeMagicLinkResult> {
  const now = opts.now ?? (() => new Date());
  const tokenHash = hashToken(opts.token);

  return prisma.$transaction(async (tx) => {
    const row = await tx.magicLinkToken.findUnique({
      where: { tokenHash },
    });
    if (!row) {
      return { ok: false, reason: "not_found" } as const;
    }
    if (row.consumedAt) {
      return { ok: false, reason: "already_used" } as const;
    }
    if (row.expiresAt.getTime() < now().getTime()) {
      return { ok: false, reason: "expired" } as const;
    }
    if (
      opts.expectedOrganizationId &&
      row.organizationId !== opts.expectedOrganizationId
    ) {
      return { ok: false, reason: "wrong_organization" } as const;
    }

    // Atomic single-use consumption. `updateMany` with a where-clause that
    // mentions `consumedAt: null` is what makes this race-safe: if a
    // concurrent redeem already flipped `consumedAt`, our update affects
    // zero rows and we surface `already_used`.
    const { count } = await tx.magicLinkToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: now() },
    });
    if (count === 0) {
      return { ok: false, reason: "already_used" } as const;
    }

    return {
      ok: true,
      organizationId: row.organizationId,
      email: row.email,
    };
  });
}

/**
 * Periodic sweep — delete tokens that are either expired or have already
 * been consumed AND were created more than 7 days ago. Keeping consumed
 * tokens around for a week preserves audit context ("did this user use a
 * magic link to sign in on day X?") without ballooning the table.
 */
export async function gcExpiredMagicLinks(now: () => Date = () => new Date()): Promise<number> {
  const cutoff7d = new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000);
  const { count } = await prisma.magicLinkToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now() }, consumedAt: null },
        { consumedAt: { lt: cutoff7d } },
      ],
    },
  });
  return count;
}
