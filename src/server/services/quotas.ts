/**
 * Per-organization plan-tier quotas (plan §10).
 *
 * Quotas are derived from the org's `plan` enum (FREE/PRO/ENTERPRISE).
 * `checkQuota` reads the current usage from the DB; `enforceQuota`
 * throws `QuotaExceededError` when at or over the limit.
 *
 * ─── Race-safety ────────────────────────────────────────────────────────
 * Quotas have a classic check-then-act race: two concurrent
 * `node.enroll` calls could both read 4/5, both decide they're allowed,
 * and both insert — landing the persisted count at 6/5. To prevent that
 * `enforceQuota` REQUIRES a Prisma transaction client and takes a per-
 * `(org, quota)` `pg_advisory_xact_lock` before the count read. Callers
 * MUST perform the resource INSERT on the SAME tx within the SAME
 * `prisma.$transaction` boundary, otherwise the lock is released before
 * the INSERT and the race is back.
 *
 *   await prisma.$transaction(async (tx) => {
 *     await enforceQuota(tx, orgId, "agents");
 *     await tx.vectorNode.create({ data: { ... } });
 *   });
 *
 * `checkQuota` is read-only (informational; UI badges, dashboards) and
 * does not need the lock — callers MUST NOT use it as a pre-flight that
 * the create path then trusts.
 *
 * Foundation only. Wiring quotas into the actual creation paths
 * (`node.enroll`, `pipeline.create`, etc.) is a separate mechanical PR.
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

/**
 * Minimal Prisma TX client shape used by enforceQuota. Mirrors the methods
 * that the official `Prisma.TransactionClient` exposes, but kept as a
 * structural type so tests can pass in stubs without depending on the
 * generated client's exact shape.
 */
export interface PrismaTxLike {
  $executeRaw(template: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  organization: { findUnique: Prisma.OrganizationDelegate["findUnique"] };
  vectorNode: { count: Prisma.VectorNodeDelegate["count"] };
  pipeline: { count: Prisma.PipelineDelegate["count"] };
  environment: { count: Prisma.EnvironmentDelegate["count"] };
}

async function countCurrentUsage(
  tx: PrismaTxLike | typeof prisma,
  organizationId: string,
  quota: QuotaName,
): Promise<number> {
  switch (quota) {
    case "agents":
      return tx.vectorNode.count({ where: { organizationId } });
    case "pipelines":
      return tx.pipeline.count({ where: { organizationId } });
    case "environments":
      return tx.environment.count({ where: { organizationId } });
  }
}

/**
 * Read-only quota check. Suitable for UI badges / dashboards. NOT a
 * gate for creation paths — use `enforceQuota` inside the create
 * transaction instead.
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
 * Atomic quota gate. Takes a per-(org, quota) Postgres advisory transaction
 * lock so that concurrent create calls serialise; the lock releases on
 * tx commit/abort. Throws `QuotaExceededError` when at or over the
 * limit.
 *
 * MUST be called inside a `prisma.$transaction`, with the resource
 * INSERT performed on the SAME `tx` client. Otherwise the lock is
 * released before the INSERT and the race is reintroduced.
 */
export async function enforceQuota(
  tx: PrismaTxLike,
  organizationId: string,
  quota: QuotaName,
): Promise<void> {
  // Acquire the per-(org, quota) advisory lock first. The lock auto-
  // releases on tx commit/abort, so the caller's INSERT immediately
  // after is also serialised.
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
