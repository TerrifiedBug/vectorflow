/**
 * Crypto v3 callsite helpers..
 *
 * The v3 envelope-encryption API (`encryptForOrg`, `decryptForOrg` in
 * `crypto.ts`) requires the org's `dataKeyCiphertext` and a row
 * identity. Orgs that have a provisioned DEK carry both. For OSS / self-
 * hosted deployments, the org row's `dataKeyCiphertext` is NULL — no
 * KMS is configured, and there is no DEK to wrap. The legacy v2
 * (`encrypt`/`decrypt`) path stays live for those rows.
 *
 * This module provides drop-in callsite helpers that pick the right
 * path automatically:
 *
 *   - `encryptForOrgOrFallback(plaintext, ctx)`:
 *     * if `ctx.dataKeyCiphertext` is set → encrypt with v3 (AAD-bound).
 *     * otherwise → encrypt with legacy v2 (HKDF off NEXTAUTH_SECRET).
 *
 *   - `decryptForOrgOrFallback(ciphertext, ctx)`:
 *     * inspects the prefix on the ciphertext.
 *     * `v3:` → decryptForOrg (AAD-bound).
 *     * `v2:` or no prefix → decrypt (v2/v1 path).
 *
 * The wrapper preserves the existing OSS contract: a deployment that
 * never sets `Organization.dataKeyCiphertext` continues to write v2
 * ciphertexts and reads back exactly what it wrote. Orgs provisioned
 * with a DEK write v3 from the start. A self-hosted operator who later
 * opts into v3 runs `scripts/migrate-encryption-v3.ts` which rewrites
 * v2 rows to v3 once per org; the wrapper detects the new prefix on
 * the next read.
 *
 * Per-callsite migration pattern:
 *
 *   // before
 *   const ct = encrypt(secret, ENCRYPTION_DOMAINS.TOTP);
 *
 *   // after
 *   const ct = await encryptForOrgOrFallback(secret, {
 *     orgId,
 *     dataKeyCiphertext,       // from Organization row
 *     domain: ENCRYPTION_DOMAINS.TOTP,
 *     rowTable: "User",
 *     rowId: userId,
 *   });
 *
 * The async-ification is the price of admission for v3 (KMS unwrap +
 * AAD assembly); callers that previously used the sync `encrypt`/
 * `decrypt` form become async. This is mechanical to fix at each
 * callsite.
 */

import {
  encrypt,
  decrypt,
  encryptForOrg,
  decryptForOrg,
  type EncryptionDomain,
  type OrgEncryptionContext,
} from "@/server/services/crypto";
import { adminPrisma } from "@/lib/prisma";

/**
 * Context for a callsite-level encrypt / decrypt. `dataKeyCiphertext`
 * is nullable because OSS / self-hosted orgs have no DEK configured;
 * the helper falls through to v2 in that case.
 */
export interface CallsiteCryptoContext {
  /** The Organization.id that owns the row. */
  orgId: string;
  /**
   * The org's `Organization.dataKeyCiphertext`. Null in OSS / self-
   * hosted; non-null when an org has been provisioned with a DEK.
   */
  dataKeyCiphertext: string | null;
  /** HKDF domain so independent data types use independent keys. */
  domain: EncryptionDomain;
  /** Prisma model name (or stable per-table identifier) the row lives in. */
  rowTable: string;
  /** Primary key of the row being encrypted. */
  rowId: string;
}

/**
 * Drop-in v3-or-v2 encrypt. Returns the ciphertext string ready to
 * persist on the row.
 */
export async function encryptForOrgOrFallback(
  plaintext: string,
  ctx: CallsiteCryptoContext,
): Promise<string> {
  if (ctx.dataKeyCiphertext) {
    return encryptForOrg(plaintext, toOrgEncryptionContext(ctx));
  }
  return encrypt(plaintext, ctx.domain);
}

/**
 * Drop-in v3-or-v2 decrypt. Selects the path based on the ciphertext
 * prefix; never silently falls back across version boundaries (a v3
 * ciphertext with a missing DEK is a hard error — the caller's row
 * is unreadable without KMS, and we MUST surface that rather than
 * returning garbage).
 */
export async function decryptForOrgOrFallback(
  ciphertext: string,
  ctx: CallsiteCryptoContext,
): Promise<string> {
  if (ciphertext.startsWith("v3:")) {
    if (!ctx.dataKeyCiphertext) {
      throw new Error(
        `decryptForOrgOrFallback: v3 ciphertext for org ${ctx.orgId} but no dataKeyCiphertext on the Organization row; KMS misconfiguration`,
      );
    }
    return decryptForOrg(ciphertext, toOrgEncryptionContext(ctx));
  }
  // v2: prefix or legacy (no prefix) — fall through to the v2 path.
  return decrypt(ciphertext, ctx.domain);
}

function toOrgEncryptionContext(
  ctx: CallsiteCryptoContext,
): OrgEncryptionContext {
  if (!ctx.dataKeyCiphertext) {
    // Defensive — the caller already branched on `dataKeyCiphertext`,
    // but TypeScript can't narrow across the await boundary in some
    // older flow-analysis paths. Be explicit so a future refactor
    // can't accidentally pass a NULL through.
    throw new Error(
      "toOrgEncryptionContext: dataKeyCiphertext is required for v3",
    );
  }
  return {
    orgId: ctx.orgId,
    dataKeyCiphertext: ctx.dataKeyCiphertext,
    domain: ctx.domain,
    rowTable: ctx.rowTable,
    rowId: ctx.rowId,
  };
}

/**
 * Resolve an org's `dataKeyCiphertext` via a single round-trip.
 * Returns `null` when the org has no DEK (OSS / self-hosted) — the
 * signal to fall through to v2 in `encryptForOrgOrFallback` /
 * `decryptForOrgOrFallback`.
 *
 * Reads on the ADMIN connection deliberately: the wrapped DEK is per-org
 * key-management infrastructure (like the per-org JWT signing key) and the
 * `orgId` is always derived from a row the caller is already authorized for
 * (env/team/endpoint). It must resolve regardless of the active RLS scope —
 * the Organization table is fenced, so a scoped read would return `null`
 * whenever the caller's context org differs from `orgId` (or no scope is set,
 * e.g. during auth-instance construction), silently breaking v3 decryption.
 *
 * Returns `null` (not a thrown error) for "org row missing" so OSS /
 * default-org callsites where the row may not yet be materialised do
 * not 500. Production multi-tenant orgs always have the row by the
 * time any callsite reaches this code path.
 */
export async function loadOrgDataKeyCiphertext(
  orgId: string,
): Promise<string | null> {
  const row = await adminPrisma.organization.findUnique({
    where: { id: orgId },
    select: { dataKeyCiphertext: true },
  });
  return row?.dataKeyCiphertext ?? null;
}
