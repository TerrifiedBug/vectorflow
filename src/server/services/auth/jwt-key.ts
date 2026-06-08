/**
 * Per-org JWT signing key resolution + revocation..
 *
 * NextAuth's `secret` option accepts a string OR an array of strings.
 * For orgs with a provisioned DEK (`Organization.dataKeyCiphertext` set)
 * we derive the secret from the DEK via
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

import { adminPrisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { deriveJwtSigningKey } from "@/server/services/crypto";
import { getDekCache } from "@/server/services/kms";
import { writeAuditLog } from "@/server/services/audit";
import { infoLog, warnLog } from "@/lib/logger";

export interface JwtKeyResult {
  /**
   * The resolved signing key as a Buffer. For env-fallback orgs the
   * raw bytes of NEXTAUTH_SECRET are returned; callers in auth.ts must
   * pass the raw env string (not base64url-encode this Buffer) so
   * existing sessions signed with the raw secret remain valid.
   */
  value: Buffer;
  /**
   * True when the key came from NEXTAUTH_SECRET rather than a per-org
   * DEK. auth.ts uses the raw env string instead of base64url-encoding
   * the Buffer to preserve backward compatibility with sessions signed
   * before per-org key derivation was added.
   */
  fromEnv: boolean;
  /**
   * True when the org HAS a DEK ciphertext but KMS unwrap failed. The
   * fallback to NEXTAUTH_SECRET is correct for availability, but the
   * auth instance MUST NOT be cached so the next request retries KMS
   * and re-derives the correct per-org key once KMS recovers.
   */
  kmsFailure: boolean;
  /**
   * The org's current `jwtKeyRotationCounter`. When > 0 the org has had at
   * least one explicit session revocation, meaning all pre-DEK tokens have
   * been explicitly invalidated. auth.ts uses this to decide whether to
   * include the legacy NEXTAUTH_SECRET as a secondary verification key:
   * it should NOT be included once the org has rotated (counter > 0).
   */
  rotationCounter: number;
}

/**
 * Custom payload claims included in every VectorFlow-issued JWT.
 * NextAuth extends its standard set (iat, exp, sub, jti) with these fields.
 * Documented here alongside the key-derivation logic so the two concerns
 * stay co-located: a claim that is enforced by the signing key (org binding)
 * is also visible in the type that describes the payload.
 */
export interface VfJwtPayload {
  /** Opaque user id (`User.id`). */
  id?: string;
  /** Auth provider used on sign-in (`credentials`, `oidc`, `webauthn`). */
  provider?: string;
  /**
   * Organisation id this token was issued for. Mirrors the per-org
   * signing key binding so env-fallback orgs (sharing `NEXTAUTH_SECRET`)
   * get a claim-level guard in addition to the signature check.
   * Absent on tokens minted before H7 was deployed — those tokens are
   * treated as invalid by the cross-org guard in auth.ts.
   */
  org_id: string;
}

/**
 * Resolve the JWT signing secret(s) for an org. Returns a typed result
 * indicating the source so auth.ts can decide how to pass the value to
 * NextAuth and whether to cache the resulting auth instance.
 *
 * Throws if neither a per-org DEK nor `NEXTAUTH_SECRET` is configured.
 */
export async function getJwtSecretForOrg(orgId: string): Promise<JwtKeyResult> {
  const org = await adminPrisma.organization.findUnique({
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
      return {
        value: deriveJwtSigningKey(dek, org.jwtKeyRotationCounter),
        fromEnv: false,
        kmsFailure: false,
        rotationCounter: org.jwtKeyRotationCounter,
      };
    } catch (err) {
      // KMS hiccup; fall through to the env-secret path so sign-in
      // doesn't break. Log loudly — operators need to see this.
      // Mark kmsFailure=true so auth.ts does NOT cache this instance:
      // the next request should retry KMS once it recovers.
      warnLog(
        "jwt-key",
        `DEK unwrap failed for org ${orgId}; falling back to NEXTAUTH_SECRET`,
        err,
      );
      const envSecret = process.env.NEXTAUTH_SECRET;
      if (!envSecret) {
        throw new Error(
          "getJwtSecretForOrg: neither per-org DEK nor NEXTAUTH_SECRET is configured",
        );
      }
      return {
        value: Buffer.from(envSecret, "utf8"),
        fromEnv: true,
        kmsFailure: true,
        rotationCounter: org.jwtKeyRotationCounter,
      };
    }
  }

  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret) {
    throw new Error(
      "getJwtSecretForOrg: neither per-org DEK nor NEXTAUTH_SECRET is configured",
    );
  }
  return { value: Buffer.from(envSecret, "utf8"), fromEnv: true, kmsFailure: false, rotationCounter: 0 };
}

/**
 * The single JWT signing key (as a string) that `auth.ts` passes as the
 * FIRST entry of NextAuth's `secret` array. The custom SAML ACS route mints
 * its session cookie with this exact key so a SAML-issued JWT verifies
 * identically to an OIDC- or credentials-issued one — same per-org signing
 * key, same `org_id` claim binding.
 *
 *   - env-fallback orgs (no DEK): the raw `NEXTAUTH_SECRET` string, matching
 *     `auth.ts`'s `secretArg = [process.env.NEXTAUTH_SECRET!]`.
 *   - DEK-provisioned orgs: the base64url encoding of the derived key,
 *     matching `auth.ts`'s `jwtKeyResult.value.toString("base64url")`.
 *
 * Throws (via `getJwtSecretForOrg`) when neither a per-org DEK nor
 * `NEXTAUTH_SECRET` is configured.
 */
export async function getSessionSigningKey(orgId: string): Promise<string> {
  const result = await getJwtSecretForOrg(orgId);
  return result.fromEnv
    ? process.env.NEXTAUTH_SECRET!
    : result.value.toString("base64url");
}

export interface RevokeOrgSessionsRequestor {
  /** "customer" = owner/admin self-serve; "operator" = a platform-operator account. */
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
 * atomically and writes an audit row. Callers are responsible for
 * clearing the per-org NextAuth instance cache (`invalidateAuthCache`)
 * after this returns; we don't import that helper here to avoid an
 * `auth.ts` ← `jwt-key.ts` cycle.
 *
 * The counter is incremented with a Prisma `{ increment: 1 }` operation
 * so concurrent revoke calls each produce a distinct new key — a
 * read-modify-write pattern would let two concurrent callers race to
 * the same value and only one effective rotation would occur.
 */
export async function revokeOrgSessions(
  organizationId: string,
  by: RevokeOrgSessionsRequestor,
): Promise<RevokeOrgSessionsResult> {
  const result = await withOrgTx(organizationId, async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, dataKeyCiphertext: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    // For orgs without a DEK (OSS / self-hosted using NEXTAUTH_SECRET), the
    // rotation counter has no effect — the signing key is the global env secret
    // and cannot be rotated per-org. Reject the call so callers get a clear
    // error rather than a silent no-op that misleads them into thinking sessions
    // were revoked.
    if (!org.dataKeyCiphertext) {
      throw new Error(
        `revokeOrgSessions: org ${organizationId} has no per-org DEK — ` +
        "revoke all sessions by rotating NEXTAUTH_SECRET in the environment",
      );
    }

    // Atomic increment: avoids the read-then-write race under concurrent
    // revoke calls. Prisma returns the updated row so we can embed the
    // new counter value in the audit log.
    const updated = await tx.organization.update({
      where: { id: organizationId },
      data: { jwtKeyRotationCounter: { increment: 1 } },
      select: { jwtKeyRotationCounter: true },
    });
    const newCounter = updated.jwtKeyRotationCounter;

    infoLog(
      "jwt-key",
      `revoked all sessions for org ${organizationId} (counter -> ${newCounter})`,
    );

    return { organizationId, newRotationCounter: newCounter };
  });

  // Write chained audit row OUTSIDE the transaction so writeAuditLog's
  // advisory lock does not nest inside the org-update transaction.
  writeAuditLog({
    organizationId,
    userId: by.kind === "customer" ? by.id : null,
    action: "auth.sessions_revoked",
    entityType: "Organization",
    entityId: organizationId,
    ipAddress: by.ipAddress ?? null,
    metadata: {
      requestedBy: by.kind,
      reason: by.reason ?? null,
      newRotationCounter: result.newRotationCounter,
    },
  }).catch((err) => {
    warnLog("jwt-key", `writeAuditLog failed for auth.sessions_revoked on ${organizationId}`, err);
  });

  return result;
}
