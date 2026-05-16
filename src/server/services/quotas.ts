/**
 * Per-organization plan-tier quotas (plan §10).
 *
 * Quotas are derived from the org's `plan` enum (FREE/PRO/ENTERPRISE).
 * `checkQuota` reads the current usage from the DB (read-only — UI
 * badges, dashboards). `withQuotaCheck` is the canonical creation path:
 * it opens a transaction, acquires a per-(org, quota) advisory lock,
 * counts current usage, throws `QuotaExceededError` if at/over the
 * limit, otherwise runs the supplied creation function with the SAME
 * tx so the INSERT lands while the lock is still held.
 *
 *   await withQuotaCheck(orgId, "agents", async (tx) => {
 *     return tx.vectorNode.create({ data: { ... } });
 *   });
 *
 * The wrapper owns the transaction boundary, so the create cannot
 * accidentally run outside the lock window — a class of misuse that
 * an in-tx-only "enforceQuotaInTx(tx, …)" function with a structural
 * `tx` param could not prevent (a caller could pass the root prisma).
 *
 * `enforceQuotaInTx` is exported for advanced callers who are already
 * inside a `prisma.$transaction` for unrelated reasons and want to
 * add a quota check without nesting transactions. Use the wrapper
 * unless you specifically need this.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

export type QuotaName = "agents" | "pipelines" | "environments";
export type PlanName = "FREE" | "PRO" | "ENTERPRISE";

export interface PlanQuotas {
  agents: number;
  pipelines: number;
  environments: number;
}

export const PLAN_QUOTAS: Record<PlanName, PlanQuotas> = {
  FREE: { agents: 5, pipelines: 10, environments: 1 },
  PRO: { agents: 100, pipelines: 100, environments: 10 },
  ENTERPRISE: {
    agents: Number.POSITIVE_INFINITY,
    pipelines: Number.POSITIVE_INFINITY,
    environments: Number.POSITIVE_INFINITY,
  },
};

export interface QuotaResult {
  allowed: boolean;
  limit: number;
  current: number;
  plan: PlanName;
  quota: QuotaName;
}

export class QuotaExceededError extends Error {
  readonly organizationId: string;
  readonly plan: PlanName;
  readonly quota: QuotaName;
  readonly limit: number;
  readonly current: number;

  constructor(
    organizationId: string,
    plan: PlanName,
    quota: QuotaName,
    limit: number,
    current: number,
  ) {
    super(
      `quota exceeded: org ${organizationId} (${plan}) is at ${current}/${limit} ${quota}`,
    );
    this.name = "QuotaExceededError";
    this.organizationId = organizationId;
    this.plan = plan;
    this.quota = quota;
    this.limit = limit;
    this.current = current;
  }
}

export interface PrismaTxLike {
  $executeRaw(template: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  organization: { findUnique: Prisma.OrganizationDelegate["findUnique"] };
  vectorNode: { count: Prisma.VectorNodeDelegate["count"] };
  pipeline: { count: Prisma.PipelineDelegate["count"] };
  environment: { count: Prisma.EnvironmentDelegate["count"] };
}

async function countCurrentUsage(
  client: PrismaTxLike | typeof prisma,
  organizationId: string,
  quota: QuotaName,
): Promise<number> {
  switch (quota) {
    case "agents":
      return client.vectorNode.count({ where: { organizationId } });
    case "pipelines":
      return client.pipeline.count({ where: { organizationId } });
    case "environments":
      return client.environment.count({ where: { organizationId } });
  }
}

/**
 * Read-only quota check. Suitable for UI badges / dashboards. NOT a
 * gate for creation paths — use `withQuotaCheck` instead.
 */
export async function checkQuota(
  organizationId: string,
  quota: QuotaName,
): Promise<QuotaResult> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true },
  });
  if (!org) {
    throw new Error(`Organization ${organizationId} not found`);
  }
  const plan = org.plan as PlanName;
  const limit = PLAN_QUOTAS[plan][quota];
  const current = await countCurrentUsage(prisma, organizationId, quota);
  return {
    allowed: current < limit,
    limit,
    current,
    plan,
    quota,
  };
}

/**
 * In-tx quota gate. Acquires the per-(org, quota) `pg_advisory_xact_lock`
 * and verifies the current count is below the plan limit.
 *
 * Advanced API — use only when you are already inside a
 * `prisma.$transaction` boundary for unrelated reasons. The caller
 * MUST then perform the resource INSERT on the SAME `tx` client.
 * Most callers want `withQuotaCheck` instead.
 */
export async function enforceQuotaInTx(
  tx: PrismaTxLike,
  organizationId: string,
  quota: QuotaName,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${organizationId}:${quota}`}))`;

  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true },
  });
  if (!org) {
    throw new Error(`Organization ${organizationId} not found`);
  }
  const plan = org.plan as PlanName;
  const limit = PLAN_QUOTAS[plan][quota];
  const current = await countCurrentUsage(tx, organizationId, quota);
  if (current >= limit) {
    throw new QuotaExceededError(organizationId, plan, quota, limit, current);
  }
}

/**
 * Canonical create-with-quota helper. Opens a transaction, takes the
 * per-(org, quota) advisory lock, verifies the current count is below
 * the limit, invokes the supplied `create` callback with the SAME tx,
 * then **re-verifies** the post-callback count is still within the
 * limit. The post-check defeats not only races (already serialised by
 * the lock) but also callbacks that issue multiple inserts or use
 * `createMany` to slip past a single pre-check.
 *
 *   await withQuotaCheck(orgId, "agents", (tx) =>
 *     tx.vectorNode.create({ data: { ... } }),
 *   );
 *
 * Sequence:
 *   1. pg_advisory_xact_lock per (orgId, quota)
 *   2. count before — throw if at limit
 *   3. invoke create(tx) — may insert 1+ rows
 *   4. count after — throw if over limit (rolls back the inserts)
 *
 * Throws `QuotaExceededError` if the callback produces more inserts
 * than the remaining headroom; the transaction rolls back so the
 * customer is never billed for over-quota work.
 */
export async function withQuotaCheck<T>(
  organizationId: string,
  quota: QuotaName,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const txLike = tx as unknown as PrismaTxLike;
    // Pre-check (locks + verifies headroom).
    await enforceQuotaInTx(txLike, organizationId, quota);

    const result = await create(tx);

    // Post-check — defeats `createMany`/multi-insert callbacks that
    // a single pre-check cannot stop. Re-read the count INSIDE the
    // still-locked transaction; if the callback added more rows than
    // headroom, throw and roll back.
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    const plan = org.plan as PlanName;
    const limit = PLAN_QUOTAS[plan][quota];
    const after = await countCurrentUsage(txLike, organizationId, quota);
    if (after > limit) {
      throw new QuotaExceededError(organizationId, plan, quota, limit, after);
    }

    return result;
  });
}
