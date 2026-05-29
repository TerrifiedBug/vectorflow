/**
 * Envelope-encryption migration (v2 → v3 ciphertexts).
 *
 * Walks every per-org encrypted column and re-wraps the value as a v3
 * ciphertext bound to the row's organization. Per-org DEKs are minted on
 * demand via the configured KMS provider.
 *
 * Idempotent: re-running over already-v3 values is a no-op. Dry-run mode
 * makes no writes.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-encryption-v3.ts --dry-run
 *   pnpm tsx scripts/migrate-encryption-v3.ts
 */

import { PrismaClient } from "../src/generated/prisma";
import { ENCRYPTION_DOMAINS } from "../src/server/services/crypto";
import {
  ensureOrgDataKey,
  migrateValue,
  newCounters,
  tally,
  type MigrationCounters,
  type MigrationRowContext,
} from "../src/server/services/migrate-encryption-v3";

const prisma = new PrismaClient();
const isDryRun = process.argv.includes("--dry-run");

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

async function ensureAllOrgKeys(): Promise<Map<string, string>> {
  log("\n── Ensure every Organization has a wrapped DEK ──");
  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, dataKeyCiphertext: true },
  });
  const dekByOrg = new Map<string, string>();
  for (const org of orgs) {
    const { changed, dataKeyCiphertext } = await ensureOrgDataKey(org);
    dekByOrg.set(org.id, dataKeyCiphertext);
    if (changed) {
      log(`  [generate] Organization(${org.slug}) — wrapping new DEK`);
      if (!isDryRun) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { dataKeyCiphertext },
        });
      }
    } else {
      log(`  [skip] Organization(${org.slug}) — DEK already wrapped`);
    }
  }
  return dekByOrg;
}

async function migrateOne(
  value: string | null,
  ctx: MigrationRowContext,
  apply: (v: string) => Promise<unknown>,
  counters: MigrationCounters,
  label: string,
): Promise<void> {
  const r = await migrateValue(value, ctx);
  tally(counters, r);
  if (r.status === "migrated" && r.ciphertext && !isDryRun) {
    await apply(r.ciphertext);
  }
  if (r.status === "error") log(`  [error] ${label} — ${r.error}`);
}

async function main(): Promise<void> {
  if (!process.env.NEXTAUTH_SECRET) {
    log("ERROR: NEXTAUTH_SECRET must be set (used to decrypt v1/v2 ciphertexts).");
    process.exit(1);
  }
  log(`\nv3 envelope-encryption migration${isDryRun ? " [DRY RUN]" : ""}`);
  log("=".repeat(60));

  const dekByOrg = await ensureAllOrgKeys();
  const counters = newCounters();

  function dek(orgId: string): string | undefined {
    return dekByOrg.get(orgId);
  }

  // ─── Secret.encryptedValue (per env, env.organizationId is the tenancy) ──
  // AAD/domain MUST match every runtime reader (secret-resolver.ts,
  // secret.ts, agent/config/route.ts): domain GENERIC, rowId
  // `${environmentId}:${name}`. Using anything else makes the migrated v3
  // ciphertext undecryptable at runtime.
  log("\n── Secret.encryptedValue ──");
  const secrets = await prisma.secret.findMany({
    select: {
      id: true,
      name: true,
      environmentId: true,
      encryptedValue: true,
      environment: { select: { organizationId: true } },
    },
  });
  for (const row of secrets) {
    const orgId = row.environment.organizationId;
    const d = dek(orgId);
    if (!d) {
      counters.errors++;
      log(`  [error] Secret(${row.name}) — no DEK for org ${orgId}`);
      continue;
    }
    await migrateOne(
      row.encryptedValue,
      {
        orgId,
        dataKeyCiphertext: d,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret",
        rowId: `${row.environmentId}:${row.name}`,
      },
      (v) => prisma.secret.update({ where: { id: row.id }, data: { encryptedValue: v } }),
      counters,
      `Secret(${row.name})`,
    );
  }

  // ─── Certificate.encryptedData ──
  log("\n── Certificate.encryptedData ──");
  const certs = await prisma.certificate.findMany({
    select: {
      id: true,
      name: true,
      encryptedData: true,
      environment: { select: { organizationId: true } },
    },
  });
  for (const row of certs) {
    const orgId = row.environment.organizationId;
    const d = dek(orgId);
    if (!d) {
      counters.errors++;
      log(`  [error] Certificate(${row.name}) — no DEK for org ${orgId}`);
      continue;
    }
    await migrateOne(
      row.encryptedData,
      {
        orgId,
        dataKeyCiphertext: d,
        domain: ENCRYPTION_DOMAINS.CERTIFICATES,
        rowTable: "Certificate",
        rowId: row.id,
      },
      (v) =>
        prisma.certificate.update({ where: { id: row.id }, data: { encryptedData: v } }),
      counters,
      `Certificate(${row.name})`,
    );
  }

  // ─── Team.aiApiKey ──
  log("\n── Team.aiApiKey ──");
  const teams = await prisma.team.findMany({
    where: { aiApiKey: { not: null } },
    select: { id: true, name: true, organizationId: true, aiApiKey: true },
  });
  for (const row of teams) {
    const d = dek(row.organizationId);
    if (!d) {
      counters.errors++;
      log(`  [error] Team(${row.name}) — no DEK for org ${row.organizationId}`);
      continue;
    }
    await migrateOne(
      row.aiApiKey,
      {
        orgId: row.organizationId,
        dataKeyCiphertext: d,
        domain: ENCRYPTION_DOMAINS.SECRETS,
        rowTable: "Team",
        rowId: row.id,
      },
      (v) => prisma.team.update({ where: { id: row.id }, data: { aiApiKey: v } }),
      counters,
      `Team(${row.name}).aiApiKey`,
    );
  }

  // ─── Environment.gitToken / gitWebhookSecret ──
  log("\n── Environment.gitToken / gitWebhookSecret ──");
  const envs = await prisma.environment.findMany({
    where: {
      OR: [{ gitToken: { not: null } }, { gitWebhookSecret: { not: null } }],
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      gitToken: true,
      gitWebhookSecret: true,
    },
  });
  for (const row of envs) {
    const d = dek(row.organizationId);
    if (!d) {
      counters.errors++;
      log(`  [error] Environment(${row.name}) — no DEK for org ${row.organizationId}`);
      continue;
    }
    // gitToken AAD/domain MUST match the runtime readers (environment.ts,
    // git-sync.ts, gitops-promotion.ts, webhooks/git/route.ts) and
    // rotate-org-dek.ts: domain GENERIC, rowId = the bare environment id.
    await migrateOne(
      row.gitToken,
      {
        orgId: row.organizationId,
        dataKeyCiphertext: d,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Environment",
        rowId: row.id,
      },
      (v) => prisma.environment.update({ where: { id: row.id }, data: { gitToken: v } }),
      counters,
      `Environment(${row.name}).gitToken`,
    );
    // gitWebhookSecret AAD/domain MUST match its runtime reader
    // (webhooks/git/route.ts decryptForOrgOrFallback): domain GENERIC,
    // rowId = the bare environment id.
    await migrateOne(
      row.gitWebhookSecret,
      {
        orgId: row.organizationId,
        dataKeyCiphertext: d,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Environment",
        rowId: row.id,
      },
      (v) =>
        prisma.environment.update({
          where: { id: row.id },
          data: { gitWebhookSecret: v },
        }),
      counters,
      `Environment(${row.name}).gitWebhookSecret`,
    );
  }

  // ─── WebhookEndpoint.encryptedSecret ──
  log("\n── WebhookEndpoint.encryptedSecret ──");
  const webhooks = await prisma.webhookEndpoint.findMany({
    where: { encryptedSecret: { not: null } },
    select: {
      id: true,
      name: true,
      organizationId: true,
      encryptedSecret: true,
    },
  });
  for (const row of webhooks) {
    const d = dek(row.organizationId);
    if (!d) {
      counters.errors++;
      log(`  [error] WebhookEndpoint(${row.name}) — no DEK for org ${row.organizationId}`);
      continue;
    }
    await migrateOne(
      row.encryptedSecret,
      {
        orgId: row.organizationId,
        dataKeyCiphertext: d,
        domain: ENCRYPTION_DOMAINS.SECRETS,
        rowTable: "WebhookEndpoint",
        rowId: row.id,
      },
      (v) =>
        prisma.webhookEndpoint.update({
          where: { id: row.id },
          data: { encryptedSecret: v },
        }),
      counters,
      `WebhookEndpoint(${row.name})`,
    );
  }

  // ─── OrganizationSettings.oidcClientSecret ──
  log("\n── OrganizationSettings.oidcClientSecret ──");
  const settings = await prisma.organizationSettings.findMany({
    where: { oidcClientSecret: { not: null } },
    select: { id: true, organizationId: true, oidcClientSecret: true },
  });
  for (const row of settings) {
    const d = dek(row.organizationId);
    if (!d) {
      counters.errors++;
      log(`  [error] OrganizationSettings(${row.id}) — no DEK for org ${row.organizationId}`);
      continue;
    }
    await migrateOne(
      row.oidcClientSecret,
      {
        orgId: row.organizationId,
        dataKeyCiphertext: d,
        domain: ENCRYPTION_DOMAINS.SECRETS,
        rowTable: "OrganizationSettings",
        rowId: row.id,
      },
      (v) =>
        prisma.organizationSettings.update({
          where: { id: row.id },
          data: { oidcClientSecret: v },
        }),
      counters,
      `OrganizationSettings(${row.id}).oidcClientSecret`,
    );
  }

  log("\n" + "=".repeat(60));
  log(
    `Done. migrated=${counters.migrated} skipped-v3=${counters.skippedV3} ` +
      `skipped-empty=${counters.skippedEmpty} errors=${counters.errors}` +
      (isDryRun ? " (dry run)" : ""),
  );
  if (counters.errors > 0) process.exit(1);
}

main()
  .catch((err) => {
    log(`\nMigration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
