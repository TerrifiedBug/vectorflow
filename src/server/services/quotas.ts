/**
 * Per-organization resource quotas.
 *
 * # Engine
 *
 * Quotas are gated at the creation path. `withQuotaCheck` is the
 * canonical helper:
 *
 *   await withQuotaCheck(orgId, "agents", async (tx) => {
 *     return tx.vectorNode.create({ data: { ... } });
 *   });
 *
 * It opens a transaction, acquires a per-(org, quota) `pg_advisory_xact_lock`,
 * verifies the current count is below the active plan's limit, runs the
 * supplied creation callback on the SAME tx, then re-verifies post-callback
 * to defeat `createMany`/multi-insert callbacks. `QuotaExceededError` rolls
 * back the inserts so the customer is never billed for over-quota work.
 *
 * `enforceQuotaInTx` is exported for advanced callers already inside a
 * `prisma.$transaction` for unrelated reasons; `checkQuota` is read-only
 * (UI badges / dashboards).
 *
 * # Plan name decoupling
 *
 * The numeric quota schedule is supplied by an injectable
 * `QuotaPolicyProvider`. The default provider returns `UNBOUNDED` limits
 * (i.e. no quota enforcement) so a baseline deployment is functional
 * without registering anything. Deployments that need finite tiers
 * register their own provider at startup:
 *
 *   import { setQuotaPolicy } from "@/server/services/quotas";
 *   setQuotaPolicy(new MyQuotaPolicy());
 *
 * OSS ships a default provider (`DefaultUnboundedQuotaPolicy`) that
 * returns `{ agents: ∞, pipelines: ∞, environments: ∞ }` for every
 * plan name. Self-hosted deployments are therefore unmetered by
 * default — the engine, advisory locks, and error shapes are all
 * preserved so a self-hosted operator who wants quotas can register a
 * provider of their own.
 *
 * `PLAN_QUOTAS` is kept exported as a back-compat alias that reflects
 * whatever the active provider returns for the `DEFAULT` plan only.
 * Commercial tiers (FREE/PRO/ENTERPRISE) are NOT enumerable from OSS
 * code.
 */

import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import type { Prisma } from "@/generated/prisma";

export type QuotaName = "agents" | "pipelines" | "environments";

/**
 * Plan identifier. OSS only knows `"DEFAULT"`;s additional
 * commercial tiers ("FREE", "PRO", "ENTERPRISE") via its own provider.
 * Anything the does not recognise falls through to the
 * provider's DEFAULT entry.
 *
 * Kept as `string` (not a closed union) so the OSS type system does
 * not encode the commercial tier names.
 */
export type PlanName = string;

export interface PlanQuotas {
  agents: number;
  pipelines: number;
  environments: number;
}

/**
 * Provider interface — a deployment may register a commercial overlay;
 * OSS uses the default unbounded provider.
 *
 * Implementations MUST be pure (no I/O, no global state) so the quota
 * engine can call them from inside a held transaction without leaking
 * the connection.
 */
export interface QuotaPolicyProvider {
  /**
   * Return the numeric limits for the given plan name. Implementations
   * MUST return a value for every input — if the plan is unrecognised,
   * fall through to the provider's default (typically the same as
   * `DEFAULT_PLAN`).
   */
  getPlanQuotas(plan: PlanName): PlanQuotas;
}

const UNBOUNDED: PlanQuotas = {
  agents: Number.POSITIVE_INFINITY,
  pipelines: Number.POSITIVE_INFINITY,
  environments: Number.POSITIVE_INFINITY,
};

/**
 * Default OSS provider: every plan is unbounded. Self-hosted deployments
 * are unmetered by default. To enforce limits, register a custom
 * provider at startup via `setQuotaPolicy(...)`.
 */
export class DefaultUnboundedQuotaPolicy implements QuotaPolicyProvider {
  getPlanQuotas(_plan: PlanName): PlanQuotas {
    return UNBOUNDED;
  }
}

let activePolicy: QuotaPolicyProvider = new DefaultUnboundedQuotaPolicy();

/**
 * Replace the active quota policy provider. Intended to be called once
 * at startup by the deployment bootstrap before any HTTP handler or
 * scheduler runs. Tests can also override this to install a finite-limit
 * provider that exercises the engine's QuotaExceededError branch.
 *
 * Returns the previous provider so a test can restore it in afterEach.
 */
export function setQuotaPolicy(
  provider: QuotaPolicyProvider,
): QuotaPolicyProvider {
  const prev = activePolicy;
  activePolicy = provider;
  return prev;
}

/** Inspect the currently-registered provider. Mostly for tests. */
export function getQuotaPolicy(): QuotaPolicyProvider {
  return activePolicy;
}

/**
 * Reset to the OSS default. Provided for `afterEach` test cleanup;
 * production code should never call this.
 */
export function resetQuotaPolicy(): void {
  activePolicy = new DefaultUnboundedQuotaPolicy();
}

/**
 * Back-compat: `PLAN_QUOTAS.DEFAULT` reflects whatever the active
 * provider returns for the `DEFAULT` plan. Custom plan names are not
 * enumerable here — a deployment that overrides the provider queries
 * that provider directly.
 *
 * @deprecated New callers should use `getActivePlanQuotas(plan)`.
 */
export const PLAN_QUOTAS: Readonly<Record<"DEFAULT", PlanQuotas>> = Object.freeze({
  get DEFAULT(): PlanQuotas {
    return activePolicy.getPlanQuotas("DEFAULT");
  },
}) as Readonly<Record<"DEFAULT", PlanQuotas>>;

/**
 * Resolve the quotas for `plan` against the active provider.
 * Preferred over the deprecated `PLAN_QUOTAS` accessor.
 */
export function getActivePlanQuotas(plan: PlanName): PlanQuotas {
  return activePolicy.getPlanQuotas(plan);
}

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
  const limit = activePolicy.getPlanQuotas(plan)[quota];
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
  const limit = activePolicy.getPlanQuotas(plan)[quota];
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
  return withOrgTx(organizationId, async (tx) => {
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
    const limit = activePolicy.getPlanQuotas(plan)[quota];
    const after = await countCurrentUsage(txLike, organizationId, quota);
    if (after > limit) {
      throw new QuotaExceededError(organizationId, plan, quota, limit, after);
    }

    return result;
  });
}
