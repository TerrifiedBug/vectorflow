/**
 * Per-org JWT signing key resolution + revocation (plan §8 / §16b OSS-3).
 *
 * NextAuth's `secret` option accepts a string OR an array of strings.
 * For Cloud orgs we derive the secret from the org's DEK via
 * `deriveJwtSigningKey(dek, rotationCounter)`. For OSS / self-hosted
 * orgs without a DEK we fall back to `NEXTAUTH_SECRET` so the existing
 * sign-in flow continues to work.
 *
 * Rotation flow:
 *
 *   1. Owner clicks "Revoke all sessions" in the org admin UI.
 *   2. tRPC mutation calls `revokeOrgSessions(orgId, by)`.
 *   3. Service increments `Organization.jwtKeyRotationCounter` and
 *      writes an `AuditLog` row.
 *   4. The per-org NextAuth instance cache (auth.ts) is invalidated so
 *      the next request builds a fresh instance with the new derived
 *      secret. All previously-issued JWTs fail signature verification
 *      immediately.
 *
 * Cache: getJwtSecretForOrg is on the hot path — it reads on every
 * NextAuth construction. The org row (id, dataKeyCiphertext, rotation
 * counter) is fetched fresh each time but the DEK lives in the
 * in-process DekCache (5-minute TTL). The arithmetic cost of HKDF is
 * negligible.
 */

import { prisma } from "@/lib/prisma";
import { deriveJwtSigningKey } from "@/server/services/crypto";
import { getDekCache } from "@/server/services/kms";
import { writeAuditLog } from "@/server/services/audit";
import { infoLog, warnLog } from "@/lib/logger";

/**
 * Resolve the JWT signing secret(s) for an org. Returns a Buffer that
 * NextAuth can use as the `secret`. Falls back to `NEXTAUTH_SECRET`
 * (Buffer-wrapped) when the org has no DEK — OSS self-hosted path.
 *
 * Throws if neither a per-org DEK nor `NEXTAUTH_SECRET` is configured.
 */
export async function getJwtSecretForOrg(orgId: string): Promise<Buffer> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      dataKeyCiphertext: true,
      jwtKeyRotationCounter: true,
    },
  });

  if (org?.dataKeyCiphertext) {
    try {
      const cache = getDekCache();
      const dek = await cache.get(org.id, org.dataKeyCiphertext);
      return deriveJwtSigningKey(dek, org.jwtKeyRotationCounter);
    } catch (err) {
      // KMS hiccup; fall through to the env-secret path so sign-in
      // doesn't break. Log loudly — operators need to see this.
      warnLog(
        "jwt-key",
        `DEK unwrap failed for org ${orgId}; falling back to NEXTAUTH_SECRET`,
        err,
      );
    }
  }

  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret) {
    throw new Error(
      "getJwtSecretForOrg: neither per-org DEK nor NEXTAUTH_SECRET is configured",
    );
  }
  return Buffer.from(envSecret, "utf8");
}

export interface RevokeOrgSessionsRequestor {
  /** "customer" = owner/admin self-serve; "operator" = platform staff. */
  kind: "customer" | "operator";
  /** User.id when "customer"; PlatformOperator.id when "operator". */
  id: string;
  ipAddress?: string | null;
  reason?: string | null;
}

export interface RevokeOrgSessionsResult {
  organizationId: string;
  newRotationCounter: number;
}

/**
 * Owner-triggered "revoke all sessions" — bumps the rotation counter
 * by 1 and writes an audit row. Callers are responsible for clearing
 * the per-org NextAuth instance cache (`invalidateAuthCache(orgId)`)
 * after this returns; we don't import that helper here to avoid an
 * `auth.ts` ← `jwt-key.ts` cycle.
 */
export async function revokeOrgSessions(
  organizationId: string,
  by: RevokeOrgSessionsRequestor,
): Promise<RevokeOrgSessionsResult> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, jwtKeyRotationCounter: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const newCounter = org.jwtKeyRotationCounter + 1;
    await tx.organization.update({
      where: { id: organizationId },
      data: { jwtKeyRotationCounter: newCounter },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        userId: by.kind === "customer" ? by.id : null,
        action: "auth.sessions_revoked",
        entityType: "Organization",
        entityId: organizationId,
        ipAddress: by.ipAddress ?? null,
        metadata: {
          requestedBy: by.kind,
          reason: by.reason ?? null,
          newRotationCounter: newCounter,
        },
      },
    });

    infoLog(
      "jwt-key",
      `revoked all sessions for org ${organizationId} (counter -> ${newCounter})`,
    );

    return { organizationId, newRotationCounter: newCounter };
  });
}
