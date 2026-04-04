/**
 * Encryption key rotation migration script.
 *
 * Re-encrypts all V1 ciphertexts (SHA-256-derived key, no prefix) to V2 format
 * (HKDF-derived key, `v2:` prefix).
 *
 * Usage:
 *   # Step 1: Set the new key in your environment
 *   export VF_ENCRYPTION_KEY_V2="<random-32+-char-string>"
 *
 *   # Step 2: Run the migration (dry-run first)
 *   pnpm tsx scripts/migrate-encryption.ts --dry-run
 *
 *   # Step 3: Apply
 *   pnpm tsx scripts/migrate-encryption.ts
 *
 *   # Step 4: Verify all rows were migrated, then remove NEXTAUTH_SECRET
 *   # from your encryption key config (keep it for NextAuth session signing).
 *
 * Backward-compatible: decrypt() handles both V1 and V2 payloads, so the app
 * continues to work during and after migration without downtime.
 *
 * Pipeline node configs (stored with the `enc:` prefix in JSON) are handled
 * automatically — new writes use V2 format, old reads fall back to V1 decryption.
 */

import { PrismaClient } from "../src/generated/prisma";
import { decryptLegacy, encrypt } from "../src/server/services/crypto";

const prisma = new PrismaClient();

const isDryRun = process.argv.includes("--dry-run");
let errorCount = 0;

function isV1Ciphertext(value: string): boolean {
  return !value.startsWith("v2:");
}

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

/**
 * Migrates a single field value from V1 to V2 encryption.
 *
 * All fields are migrated with the default GENERIC domain because existing
 * callers (secret.ts, user.ts, cert-expiry-checker.ts, secret-resolver.ts)
 * all call decrypt() without a domain argument. Domain-separated keys can
 * be adopted later by updating callers and re-running migration.
 *
 * Returns the new V2 ciphertext, or null if no migration needed.
 */
function migrateValue(
  value: string | null | undefined,
  label: string,
): string | null {
  if (!value) return null;
  if (!isV1Ciphertext(value)) {
    log(`  [skip]   ${label} — already V2`);
    return null;
  }
  try {
    const plaintext = decryptLegacy(value);
    const newCiphertext = encrypt(plaintext);
    log(`  [migrate] ${label}`);
    return newCiphertext;
  } catch (err) {
    errorCount++;
    log(`  [error]   ${label} — decryption failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Table migrations ──────────────────────────────────────────────────────

async function migrateSecrets(): Promise<{ total: number; migrated: number }> {
  log("\n── Secret.encryptedValue ──");
  const rows = await prisma.secret.findMany({ select: { id: true, name: true, encryptedValue: true } });
  let migrated = 0;
  for (const row of rows) {
    const newValue = migrateValue(row.encryptedValue, `Secret(${row.name})`);
    if (newValue && !isDryRun) {
      await prisma.secret.update({ where: { id: row.id }, data: { encryptedValue: newValue } });
      migrated++;
    } else if (newValue) {
      migrated++;
    }
  }
  return { total: rows.length, migrated };
}

async function migrateCertificates(): Promise<{ total: number; migrated: number }> {
  log("\n── Certificate.encryptedData ──");
  const rows = await prisma.certificate.findMany({ select: { id: true, name: true, encryptedData: true } });
  let migrated = 0;
  for (const row of rows) {
    const newValue = migrateValue(row.encryptedData, `Certificate(${row.name})`);
    if (newValue && !isDryRun) {
      await prisma.certificate.update({ where: { id: row.id }, data: { encryptedData: newValue } });
      migrated++;
    } else if (newValue) {
      migrated++;
    }
  }
  return { total: rows.length, migrated };
}

async function migrateUserTotp(): Promise<{ total: number; migrated: number }> {
  log("\n── User.totpSecret / User.totpBackupCodes ──");
  const rows = await prisma.user.findMany({
    where: { OR: [{ totpSecret: { not: null } }, { totpBackupCodes: { not: null } }] },
    select: { id: true, email: true, totpSecret: true, totpBackupCodes: true },
  });
  let migrated = 0;
  for (const row of rows) {
    const updates: { totpSecret?: string; totpBackupCodes?: string } = {};

    const newSecret = migrateValue(row.totpSecret, `User(${row.email}).totpSecret`);
    if (newSecret) { updates.totpSecret = newSecret; migrated++; }

    const newCodes = migrateValue(row.totpBackupCodes, `User(${row.email}).totpBackupCodes`);
    if (newCodes) { updates.totpBackupCodes = newCodes; migrated++; }

    if (Object.keys(updates).length > 0 && !isDryRun) {
      await prisma.user.update({ where: { id: row.id }, data: updates });
    }
  }
  return { total: rows.length * 2, migrated };
}

async function migrateSystemSettings(): Promise<{ total: number; migrated: number }> {
  log("\n── SystemSettings.oidcClientSecret ──");
  const rows = await prisma.systemSettings.findMany({
    where: { oidcClientSecret: { not: null } },
    select: { id: true, oidcClientSecret: true },
  });
  let migrated = 0;
  for (const row of rows) {
    const newValue = migrateValue(row.oidcClientSecret, `SystemSettings(${row.id}).oidcClientSecret`);
    if (newValue && !isDryRun) {
      await prisma.systemSettings.update({ where: { id: row.id }, data: { oidcClientSecret: newValue } });
      migrated++;
    } else if (newValue) {
      migrated++;
    }
  }
  return { total: rows.length, migrated };
}

// NOTE: AlertWebhook.hmacSecret is stored as plaintext (used for HMAC signing),
// so it does not need encryption migration.

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.VF_ENCRYPTION_KEY_V2) {
    log("ERROR: VF_ENCRYPTION_KEY_V2 must be set before running migration.");
    log("Generate one with: openssl rand -base64 32");
    process.exit(1);
  }

  if (!process.env.NEXTAUTH_SECRET) {
    log("ERROR: NEXTAUTH_SECRET must be set to decrypt existing V1 data.");
    process.exit(1);
  }

  log(`\nEncryption key rotation migration${isDryRun ? " [DRY RUN — no writes]" : ""}`);
  log("=".repeat(60));

  const results = await Promise.all([
    migrateSecrets(),
    migrateCertificates(),
    migrateUserTotp(),
    migrateSystemSettings(),
  ]);

  const totalRows = results.reduce((sum, r) => sum + r.total, 0);
  const totalMigrated = results.reduce((sum, r) => sum + r.migrated, 0);

  log("\n" + "=".repeat(60));
  log(`Done. ${totalMigrated}/${totalRows} fields migrated, ${errorCount} errors${isDryRun ? " (dry run)" : ""}.`);

  if (errorCount > 0) {
    log(`\nERROR: ${errorCount} field(s) failed to decrypt. Do NOT remove NEXTAUTH_SECRET.`);
    log("Investigate the errors above and re-run after fixing.");
    process.exit(1);
  }

  if (!isDryRun && totalMigrated > 0) {
    log("\nNext steps:");
    log("  1. Verify the app is working correctly with the new V2 keys.");
    log("  2. Keep NEXTAUTH_SECRET set (required for NextAuth session signing).");
    log("  3. NEXTAUTH_SECRET is no longer used for encryption — only VF_ENCRYPTION_KEY_V2.");
    log("\nNote: Pipeline node configs (enc: prefix in JSON) are automatically");
    log("      backward-compatible. New writes use V2; old reads fall back to V1.");
  }
}

main()
  .catch((err) => {
    log(`\nMigration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
