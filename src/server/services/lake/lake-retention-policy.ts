import type { Prisma } from "@/generated/prisma";
import {
  LAKE_DEFAULT_HOT_DAYS,
  LAKE_DEFAULT_COLD_DAYS,
  type EffectiveRetention,
} from "@/server/services/lake/lake-retention";

/**
 * VectorFlow Lake — per-environment retention policy management (CL-9 follow-up).
 *
 * The `LakeRetentionPolicy(hotDays, coldDays)` model is org-scoped and attaches
 * to datasets via `LakeDataset.retentionPolicyId`; the daily retention sweep
 * (`sweepLakeRetention`) reads each dataset's policy at runtime and enforces its
 * `coldDays` as a DROP horizon. What was missing was a way to *set* a policy
 * without raw DB writes. This module manages a single, dedicated policy per
 * environment (named `__env:<environmentId>`) and keeps every dataset in that
 * environment attached to it, so the env-scoped settings UI can drive retention.
 *
 * What is enforced, and where:
 *   - `coldDays` (the delete horizon) is enforced per dataset by the sweep — it
 *     can SHORTEN retention below the shared `lake_events` table default (90d).
 *   - `hotDays` (the hot→cold move) is governed by the shared table TTL set at
 *     migration time; the per-env value is stored for `effectiveRetention`'s
 *     clamp and surfaced in the UI, but a per-dataset move is not issued here.
 *
 * Everything is tenant-scoped by the caller's `withOrgTx`; reads accept any
 * Prisma-ish client (base client or a transaction client).
 */

/** A client that can be the RLS-extended base client or a transaction client.
 *  Type-only import keeps this free of a runtime dependency on `@/lib/prisma`. */
type RetentionDb = (typeof import("@/lib/prisma"))["prisma"] | Prisma.TransactionClient;

/** Retention windows are bounded to keep TTL math and the UI inputs sane. */
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650; // 10 years

/** Name of the dedicated, environment-owned retention policy row. */
export function envRetentionPolicyName(environmentId: string): string {
  return `__env:${environmentId}`;
}

export interface EnvRetention {
  hotDays: number;
  coldDays: number;
  /** True when no per-env policy exists and the table defaults apply. */
  isDefault: boolean;
}

/** The table-default window every environment falls back to. */
export function defaultEnvRetention(): EffectiveRetention {
  return { hotDays: LAKE_DEFAULT_HOT_DAYS, coldDays: LAKE_DEFAULT_COLD_DAYS };
}

/**
 * Resolve an environment's effective retention: its dedicated policy if one
 * exists, otherwise the table defaults (`isDefault: true`).
 */
export async function getEnvRetention(
  db: RetentionDb,
  args: { orgId: string; environmentId: string },
): Promise<EnvRetention> {
  const policy = await db.lakeRetentionPolicy.findUnique({
    where: {
      organizationId_name: {
        organizationId: args.orgId,
        name: envRetentionPolicyName(args.environmentId),
      },
    },
    select: { hotDays: true, coldDays: true },
  });
  if (!policy) {
    const d = defaultEnvRetention();
    return { hotDays: d.hotDays, coldDays: d.coldDays, isDefault: true };
  }
  return { hotDays: policy.hotDays, coldDays: policy.coldDays, isDefault: false };
}

/** Thrown for an out-of-bounds or inverted retention window. */
export class InvalidRetentionError extends Error {}

/**
 * Validate a retention window: both ends within [MIN, MAX] and the delete
 * horizon no earlier than the hot→cold move. Throws `InvalidRetentionError`
 * (the router maps this to a 400) on violation.
 */
export function assertValidRetention(hotDays: number, coldDays: number): void {
  for (const [label, v] of [
    ["hotDays", hotDays],
    ["coldDays", coldDays],
  ] as const) {
    if (!Number.isInteger(v) || v < MIN_RETENTION_DAYS || v > MAX_RETENTION_DAYS) {
      throw new InvalidRetentionError(
        `${label} must be a whole number of days between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`,
      );
    }
  }
  if (coldDays < hotDays) {
    throw new InvalidRetentionError(
      "coldDays (delete horizon) must be greater than or equal to hotDays (hot→cold move)",
    );
  }
}

/**
 * Upsert the environment's dedicated retention policy and attach every dataset
 * in the environment to it. Returns the policy id and how many datasets are now
 * attached. Must run inside the caller's tenant transaction.
 */
export async function setEnvRetention(
  tx: Prisma.TransactionClient,
  args: { orgId: string; environmentId: string; hotDays: number; coldDays: number },
): Promise<{ policyId: string; attached: number }> {
  assertValidRetention(args.hotDays, args.coldDays);

  const policy = await tx.lakeRetentionPolicy.upsert({
    where: {
      organizationId_name: {
        organizationId: args.orgId,
        name: envRetentionPolicyName(args.environmentId),
      },
    },
    create: {
      organizationId: args.orgId,
      name: envRetentionPolicyName(args.environmentId),
      hotDays: args.hotDays,
      coldDays: args.coldDays,
    },
    update: { hotDays: args.hotDays, coldDays: args.coldDays },
    select: { id: true },
  });

  // Attach every dataset in this environment to the policy. Datasets created
  // later inherit it via `resolveEnvRetentionPolicyId` at upsert time.
  const attached = await tx.lakeDataset.updateMany({
    where: { organizationId: args.orgId, environmentId: args.environmentId },
    data: { retentionPolicyId: policy.id },
  });

  return { policyId: policy.id, attached: attached.count };
}

/**
 * Remove the environment's dedicated retention policy, detaching its datasets
 * (they revert to the table defaults). Idempotent — a no-op when no policy
 * exists. Must run inside the caller's tenant transaction.
 */
export async function clearEnvRetention(
  tx: Prisma.TransactionClient,
  args: { orgId: string; environmentId: string },
): Promise<{ cleared: boolean; detached: number }> {
  const policy = await tx.lakeRetentionPolicy.findUnique({
    where: {
      organizationId_name: {
        organizationId: args.orgId,
        name: envRetentionPolicyName(args.environmentId),
      },
    },
    select: { id: true },
  });
  if (!policy) return { cleared: false, detached: 0 };

  // Detach first so the SetNull FK relation has nothing pointing at the row.
  const detached = await tx.lakeDataset.updateMany({
    where: { organizationId: args.orgId, retentionPolicyId: policy.id },
    data: { retentionPolicyId: null },
  });
  await tx.lakeRetentionPolicy.delete({ where: { id: policy.id } });

  return { cleared: true, detached: detached.count };
}

/**
 * Resolve the dedicated retention policy id for an environment, or `null` when
 * none is set. Used at dataset creation so a new dataset inherits its
 * environment's configured retention. Accepts any Prisma-ish client.
 */
export async function resolveEnvRetentionPolicyId(
  db: RetentionDb,
  args: { orgId: string; environmentId: string },
): Promise<string | null> {
  const policy = await db.lakeRetentionPolicy.findUnique({
    where: {
      organizationId_name: {
        organizationId: args.orgId,
        name: envRetentionPolicyName(args.environmentId),
      },
    },
    select: { id: true },
  });
  return policy?.id ?? null;
}
