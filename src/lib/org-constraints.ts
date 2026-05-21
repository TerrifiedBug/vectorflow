/**
 * Per-organization constraint engine.
 *
 * Generalises the `isDemoMode()` pattern (a binary deployment-wide gate
 * that flips a handful of risky operations off) to a richer per-org
 * constraint set that also captures org lifecycle state and (in future)
 * plan-tier feature gates.
 *
 * Resolution precedence (highest → lowest):
 *   1. `deleted`    — org row missing or `deletedAt` set
 *   2. `suspended`  — `suspendedAt` set
 *   3. `demo`       — `NEXT_PUBLIC_VF_DEMO_MODE=true`
 *   4. `live`       — none of the above
 *
 * Note: `deleted`/`suspended` precede `demo` so operator visibility into
 * a tenant's actual state isn't masked by a deployment-wide demo flag.
 *
 * Constraint layer that the quota engine and the suspension middleware
 * plug into. Existing call sites of `isDemoMode()` can
 * continue to work; new code uses `getOrgConstraints(orgId)`.
 */

import { prisma } from "@/lib/prisma";

export type OrgConstraintReason = "live" | "demo" | "suspended" | "deleted";

export interface OrgConstraints {
  /** Why the org is in its current constraint state. */
  reason: OrgConstraintReason;
  /** Plan tier; future quota engine reads this. `null` when the org row is missing. */
  plan: string | null;
  /** Agents may enroll new nodes / heartbeat. */
  agentEnrollmentEnabled: boolean;
  /** AI features (recommendations, code suggestions, log enrichment) allowed. */
  aiEnabled: boolean;
  /** Outbound email (alerts, magic-link, notifications) allowed. */
  emailEnabled: boolean;
  /** Git sync / GitOps deploys allowed. */
  gitSyncEnabled: boolean;
  /** Pipeline deploys / version promotions allowed. */
  deployEnabled: boolean;
}

const ALL_DISABLED = {
  agentEnrollmentEnabled: false,
  aiEnabled: false,
  emailEnabled: false,
  gitSyncEnabled: false,
  deployEnabled: false,
};

const ALL_ENABLED = {
  agentEnrollmentEnabled: true,
  aiEnabled: true,
  emailEnabled: true,
  gitSyncEnabled: true,
  deployEnabled: true,
};

function isDemo(): boolean {
  return process.env.NEXT_PUBLIC_VF_DEMO_MODE === "true";
}

/**
 * Resolve the constraint set for an org. Cheap (single indexed Prisma read);
 * caller should not memoise across requests since suspension state can flip
 * mid-session.
 */
export async function getOrgConstraints(
  organizationId: string,
): Promise<OrgConstraints> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, suspendedAt: true, deletedAt: true, plan: true },
  });

  if (!org || org.deletedAt) {
    return { reason: "deleted", plan: org?.plan ?? null, ...ALL_DISABLED };
  }
  if (org.suspendedAt) {
    return { reason: "suspended", plan: org.plan, ...ALL_DISABLED };
  }
  if (isDemo()) {
    return { reason: "demo", plan: org.plan, ...ALL_DISABLED };
  }
  return { reason: "live", plan: org.plan, ...ALL_ENABLED };
}
