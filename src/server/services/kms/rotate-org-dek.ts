/**
 * DEK rotation service — re-wrap every v3 ciphertext for an org under a
 * freshly generated data key.
 *
 * Threat model: an operator triggers this after a potential DEK exposure
 * (compromised KMS token, insider threat, breach). The rotation:
 *
 *   1. Loads all v3-encrypted rows for the org.
 *   2. Decrypts each under the current DEK (via the global DekCache —
 *      single-flights the KMS unwrap).
 *   3. Generates a fresh 32-byte DEK via the configured KmsProvider.
 *   4. Re-encrypts all plaintexts under the new DEK.
 *   5. Atomically writes every new ciphertext + the new
 *      Organization.dataKeyCiphertext in a single transaction.
 *      An optimistic-lock guard prevents clobbering a concurrent rotation.
 *   6. Invalidates the DekCache entry so the next request unwraps the new DEK.
 *
 * Only v3:-prefixed ciphertexts are touched.  v2:/v1 values are NOT bound
 * to the org's DEK and are left unchanged.
 *
 * V3 columns covered:
 *   - Secret.encryptedValue
 *   - OrganizationSettings.oidcClientSecret
 *   - Environment.gitToken
 *   - Team.aiApiKey
 *   - WebhookEndpoint.encryptedSecret
 *
 * This list MUST stay in sync with every callsite of
 * `encryptForOrgOrFallback` / `encryptForOrg` in the codebase.
 */

import type { PrismaClient } from "@/generated/prisma";
import { decryptForOrg, encryptForOrg, ENCRYPTION_DOMAINS } from "../crypto";
import { getKmsProvider, getDekCache, type KmsProvider } from "./index";

// ─── Public API ────────────────────────────────────────────────────────────

export const DEK_ROTATE_OPERATION = "kms.rotate_org_dek" as const;

export interface RotateOrgDekInput {
  orgId: string;
  /**
   * Prisma client. Always pass explicitly; the function does NOT fall
   * back to the global singleton so tests can inject a mock without
   * touching module-level state.
   */
  prisma: PrismaClient;
  /** Override the KMS provider. Defaults to `getKmsProvider()`. */
  kms?: KmsProvider;
}

export interface RotateOrgDekResult {
  /** The new wrapped DEK ciphertext now stored on Organization. */
  newDataKeyCiphertext: string;
  /** Per-table counts of rows whose v3 ciphertext was re-encrypted. */
  reencrypted: {
    secrets: number;
    oidcClientSecrets: number;
    gitTokens: number;
    aiApiKeys: number;
    webhookSecrets: number;
  };
  /** Sum of all per-table counts. */
  totalRowsReencrypted: number;
}

/** Flat representation of one row-field that needs re-encryption. */
interface RotationEntry {
  table: "Secret" | "OrganizationSettings" | "Environment" | "Team" | "WebhookEndpoint";
  /**
   * Identity folded into the v3 AAD. MUST match the runtime callsite for the
   * column, which is NOT always the Prisma primary key — Secret binds AAD to
   * `${environmentId}:${name}` (see secret.ts:secretRowId), every other column
   * binds to the bare row id.
   */
  rowId: string;
  /** Prisma primary key used for the `where: { id }` write clause. */
  pk: string;
  ciphertext: string;
}

/**
 * Rotate the DEK for `orgId`. See module docstring for the full protocol.
 *
 * Throws:
 *   - `OrgNotFoundError`        — org row does not exist.
 *   - `OrgNoDekError`           — org has `dataKeyCiphertext = null`.
 *   - `ConcurrentRotationError` — another rotation committed between our
 *                                 read and our write.
 *   - Any KMS provider error    — propagated as-is.
 *   - Any Prisma error          — propagated as-is.
 */
export async function rotateOrgDek(
  input: RotateOrgDekInput,
): Promise<RotateOrgDekResult> {
  const { orgId, prisma } = input;
  const kms = input.kms ?? getKmsProvider();

  // ── 1. Load org ────────────────────────────────────────────────────────────
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, dataKeyCiphertext: true },
  });
  if (!org) throw new OrgNotFoundError(orgId);
  if (!org.dataKeyCiphertext) throw new OrgNoDekError(orgId);

  const oldCiphertext = org.dataKeyCiphertext;

  // ── 2. Load all v3-encrypted rows ──────────────────────────────────────────
  const [secrets, orgSettings, environments, teams, webhookEndpoints] =
    await Promise.all([
      prisma.secret.findMany({
        where: { organizationId: orgId },
        select: { id: true, environmentId: true, name: true, encryptedValue: true },
      }),
      prisma.organizationSettings.findUnique({
        where: { organizationId: orgId },
        select: { id: true, oidcClientSecret: true },
      }),
      prisma.environment.findMany({
        where: { organizationId: orgId },
        select: { id: true, gitToken: true },
      }),
      prisma.team.findMany({
        where: { organizationId: orgId },
        select: { id: true, aiApiKey: true },
      }),
      prisma.webhookEndpoint.findMany({
        where: { organizationId: orgId },
        select: { id: true, encryptedSecret: true },
      }),
    ]);

  // ── 3. Generate fresh DEK ──────────────────────────────────────────────────
  // Done AFTER loading rows so we only generate a new key if the org
  // actually exists and has a DEK.
  const { ciphertext: newCiphertext } = await kms.generateDataKey(orgId);

  // ── 4. Batch decrypt with old DEK, then batch re-encrypt with new DEK ──────
  //
  // Both passes use the DekCache: the first decrypt call fills the cache with
  // the old DEK (one KMS unwrap); subsequent decrypt calls are cache hits.
  // The first encrypt call evicts the old DEK and fills the cache with the new
  // DEK (one KMS unwrap); subsequent encrypt calls are cache hits.
  //
  // IMPORTANT: all decrypts MUST complete before any encrypt starts to avoid
  // cache thrashing (each encrypt evicts the old DEK from the cache, which
  // would force a new KMS round-trip on the next decrypt call).

  // Build a flat list of v3-only entries.
  const entries: RotationEntry[] = [
    ...secrets
      .filter((s) => s.encryptedValue.startsWith("v3:"))
      .map((s) => ({
        table: "Secret" as const,
        // AAD rowId is the composite `${environmentId}:${name}` the runtime
        // callsites use — NOT the cuid — or decrypt would fail the AAD check.
        rowId: `${s.environmentId}:${s.name}`,
        pk: s.id,
        ciphertext: s.encryptedValue,
      })),
    ...(orgSettings?.oidcClientSecret?.startsWith("v3:")
      ? [
          {
            table: "OrganizationSettings" as const,
            rowId: orgSettings.id,
            pk: orgSettings.id,
            ciphertext: orgSettings.oidcClientSecret,
          },
        ]
      : []),
    ...environments
      .filter((e) => e.gitToken?.startsWith("v3:"))
      .map((e) => ({
        table: "Environment" as const,
        rowId: e.id,
        pk: e.id,
        ciphertext: e.gitToken!,
      })),
    ...teams
      .filter((t) => t.aiApiKey?.startsWith("v3:"))
      .map((t) => ({
        table: "Team" as const,
        rowId: t.id,
        pk: t.id,
        ciphertext: t.aiApiKey!,
      })),
    ...webhookEndpoints
      .filter((w) => w.encryptedSecret?.startsWith("v3:"))
      .map((w) => ({
        table: "WebhookEndpoint" as const,
        rowId: w.id,
        pk: w.id,
        ciphertext: w.encryptedSecret!,
      })),
  ];

  // Phase A: decrypt all (single-flights the old DEK unwrap via DekCache).
  const plaintexts = await Promise.all(
    entries.map((e) =>
      decryptForOrg(e.ciphertext, {
        orgId,
        dataKeyCiphertext: oldCiphertext,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: e.table,
        rowId: e.rowId,
      }),
    ),
  );

  // Phase B: re-encrypt all (single-flights the new DEK unwrap via DekCache).
  // Because all encrypts start concurrently after all decrypts have completed,
  // the cache cleanly transitions old DEK → new DEK on the first encrypt call.
  const newCiphertexts = await Promise.all(
    entries.map((e, i) =>
      encryptForOrg(plaintexts[i]!, {
        orgId,
        dataKeyCiphertext: newCiphertext,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: e.table,
        rowId: e.rowId,
      }),
    ),
  );

  // ── 5. Atomic write ────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // Optimistic-lock: if another rotation committed between our read and
    // our write, refuse to clobber it.
    const current = await tx.organization.findUnique({
      where: { id: orgId },
      select: { dataKeyCiphertext: true },
    });
    if (!current) throw new OrgNotFoundError(orgId);
    if (current.dataKeyCiphertext !== oldCiphertext) {
      throw new ConcurrentRotationError(orgId);
    }

    const writes: Promise<unknown>[] = [];

    for (const [i, entry] of entries.entries()) {
      const newCt = newCiphertexts[i]!;
      switch (entry.table) {
        case "Secret":
          writes.push(
            tx.secret.update({
              where: { id: entry.pk },
              data: { encryptedValue: newCt },
            }),
          );
          break;
        case "OrganizationSettings":
          writes.push(
            tx.organizationSettings.update({
              where: { id: entry.pk },
              data: { oidcClientSecret: newCt },
            }),
          );
          break;
        case "Environment":
          writes.push(
            tx.environment.update({
              where: { id: entry.pk },
              data: { gitToken: newCt },
            }),
          );
          break;
        case "Team":
          writes.push(
            tx.team.update({
              where: { id: entry.pk },
              data: { aiApiKey: newCt },
            }),
          );
          break;
        case "WebhookEndpoint":
          writes.push(
            tx.webhookEndpoint.update({
              where: { id: entry.pk },
              data: { encryptedSecret: newCt },
            }),
          );
          break;
      }
    }

    // Update the org's wrapped DEK last so any mid-write crash leaves the
    // old DEK in place (the re-encrypted rows would still be readable
    // because Organization.dataKeyCiphertext still points to the old key).
    // The Organization update is the logical commit point.
    writes.push(
      tx.organization.update({
        where: { id: orgId },
        data: { dataKeyCiphertext: newCiphertext },
      }),
    );

    await Promise.all(writes);
  });

  // ── 6. Invalidate the DekCache entry ──────────────────────────────────────
  // The cache currently holds the new DEK (populated during phase B).
  // Invalidating it zeroes the plaintext buffer and forces the next request
  // to re-unwrap from the freshly committed Organization.dataKeyCiphertext.
  getDekCache().invalidate(orgId);

  // ── 7. Tally and return ──────────────────────────────────────────────────
  const count = (table: RotationEntry["table"]) =>
    entries.filter((e) => e.table === table).length;

  const reencrypted = {
    secrets: count("Secret"),
    oidcClientSecrets: count("OrganizationSettings"),
    gitTokens: count("Environment"),
    aiApiKeys: count("Team"),
    webhookSecrets: count("WebhookEndpoint"),
  };
  const totalRowsReencrypted = Object.values(reencrypted).reduce((a, b) => a + b, 0);

  return {
    newDataKeyCiphertext: newCiphertext,
    reencrypted,
    totalRowsReencrypted,
  };
}

// ─── Error classes ─────────────────────────────────────────────────────────

export class OrgNotFoundError extends Error {
  constructor(public readonly orgId: string) {
    super(`rotateOrgDek: organization ${orgId} not found`);
    this.name = "OrgNotFoundError";
  }
}

export class OrgNoDekError extends Error {
  constructor(public readonly orgId: string) {
    super(
      `rotateOrgDek: organization ${orgId} has no dataKeyCiphertext — ` +
        `not provisioned for envelope encryption (OSS / self-hosted deployment)`,
    );
    this.name = "OrgNoDekError";
  }
}

export class ConcurrentRotationError extends Error {
  constructor(public readonly orgId: string) {
    super(
      `rotateOrgDek: concurrent rotation detected for org ${orgId} — ` +
        `dataKeyCiphertext changed between read and write; retry the rotation`,
    );
    this.name = "ConcurrentRotationError";
  }
}
