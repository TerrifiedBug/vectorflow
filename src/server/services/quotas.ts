/**
 * Per-organization plan-tier quotas (plan §10).
 *
 * Quotas are derived from the org's `plan` enum (FREE/PRO/ENTERPRISE).
 * `checkQuota` reads the current usage from the DB; `enforceQuota`
 * throws `QuotaExceededError` when at or over the limit.
 *
 * The structured error gives routers everything they need to render a
 * useful "Upgrade to PRO" CTA without leaking the customer's plan to
 * other tenants — the throw site decides how much to expose to the
 * client.
 *
 * Foundation only. Wiring quotas into the actual creation paths
 * (`node.enroll`, `pipeline.create`, etc.) is a separate mechanical PR.
 */

import { prisma } from "@/lib/prisma";

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

async function countCurrentUsage(
  organizationId: string,
  quota: QuotaName,
): Promise<number> {
  switch (quota) {
    case "agents":
      return prisma.vectorNode.count({ where: { organizationId } });
    case "pipelines":
      return prisma.pipeline.count({ where: { organizationId } });
    case "environments":
      return prisma.environment.count({ where: { organizationId } });
  }
}

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
  const current = await countCurrentUsage(organizationId, quota);
  return {
    allowed: current < limit,
    limit,
    current,
    plan,
    quota,
  };
}

/**
 * Throws `QuotaExceededError` when the org is at or over its limit for
 * `quota`. Callers in router mutations should let the thrown error
 * propagate to the tRPC layer; a `Quotamiddleware` (forthcoming Cloud
 * PR) will translate it to a TRPCError with the upgrade-CTA payload.
 */
export async function enforceQuota(
  organizationId: string,
  quota: QuotaName,
): Promise<void> {
  const r = await checkQuota(organizationId, quota);
  if (!r.allowed) {
    throw new QuotaExceededError(
      organizationId,
      r.plan,
      r.quota,
      r.limit,
      r.current,
    );
  }
}
