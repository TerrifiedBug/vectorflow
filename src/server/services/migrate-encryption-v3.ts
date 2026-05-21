/**
 * Envelope-encryption migration helpers (v2 → v3 ciphertexts).
 *
 * Walks tenant tables row-by-row and re-encrypts `v2:` ciphertexts as v3
 * envelope-encrypted blobs bound to the row's org. Designed to be:
 *   - **Idempotent.** Re-running over already-v3 rows is a no-op.
 *   - **Dry-runnable.** No writes when `dryRun: true`.
 *   - **Per-org.** Each row is re-encrypted under its own org's DEK.
 *
 * Pure functions live here; the orchestration script
 * (`scripts/migrate-encryption-v3.ts`) wires them to Prisma.
 */

import { decrypt, encryptForOrg } from "./crypto";
import type { EncryptionDomain } from "./crypto";
import { getKmsProvider } from "./kms";

export interface MigrationRowContext {
  orgId: string;
  dataKeyCiphertext: string;
  domain: EncryptionDomain;
  rowTable: string;
  rowId: string;
}

export interface MigrationResult {
  status: "migrated" | "skipped-v3" | "skipped-empty" | "error";
  ciphertext?: string;
  error?: string;
}

/**
 * Return the v3 ciphertext for a value that may be:
 *   - empty / null    → `skipped-empty`
 *   - `v3:` prefixed  → `skipped-v3` (already migrated)
 *   - `v2:` prefixed  → decrypt + re-encrypt + return new `v3:` payload
 *
 * Caller writes the returned `ciphertext` to the row only when `dryRun=false`.
 */
export async function migrateValue(
  value: string | null | undefined,
  ctx: MigrationRowContext,
): Promise<MigrationResult> {
  if (!value) return { status: "skipped-empty" };
  if (value.startsWith("v3:")) return { status: "skipped-v3" };
  try {
    const plaintext = decrypt(value, ctx.domain);
    const v3 = await encryptForOrg(plaintext, ctx);
    return { status: "migrated", ciphertext: v3 };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ensure `org.dataKeyCiphertext` is set. If null, generate a fresh DEK and
 * return the wrapped ciphertext to persist; otherwise return the existing
 * value unchanged.
 */
export async function ensureOrgDataKey(
  org: { id: string; dataKeyCiphertext: string | null },
): Promise<{
  changed: boolean;
  dataKeyCiphertext: string;
}> {
  if (org.dataKeyCiphertext) {
    return { changed: false, dataKeyCiphertext: org.dataKeyCiphertext };
  }
  const kms = getKmsProvider();
  const { ciphertext } = await kms.generateDataKey(org.id);
  return { changed: true, dataKeyCiphertext: ciphertext };
}

export interface MigrationCounters {
  migrated: number;
  skippedV3: number;
  skippedEmpty: number;
  errors: number;
}

export function newCounters(): MigrationCounters {
  return { migrated: 0, skippedV3: 0, skippedEmpty: 0, errors: 0 };
}

export function tally(c: MigrationCounters, r: MigrationResult): void {
  switch (r.status) {
    case "migrated":
      c.migrated++;
      break;
    case "skipped-v3":
      c.skippedV3++;
      break;
    case "skipped-empty":
      c.skippedEmpty++;
      break;
    case "error":
      c.errors++;
      break;
  }
}
