import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/is-demo-mode";
import type { Role, OrgMemberRole, PlatformOperatorRole } from "@/generated/prisma";
import { isOrgWideAdmin } from "@/lib/org-admin";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import { runWithLogContext } from "@/lib/log-context";
import { isStrictMultiTenantMode } from "@/lib/security-headers";

/**
 * Sentinel error attached as `cause` on the TRPCError thrown by `orgProcedure`
 * when an organization is suspended. The HTTP adapter's `responseMeta` callback
 * (see `src/app/api/trpc/[trpc]/route.ts`) detects this sentinel and overrides
 * the response status to `423 Locked`.
 *
 * tRPC has no built-in mapping for `423`, so we keep the in-band error code
 * `FORBIDDEN` (for client-side `code` checks) and override only the HTTP
 * status at the transport boundary.
 */
export class OrgSuspendedError extends Error {
  readonly _tag = "OrgSuspendedError" as const;
  constructor() {
    super("Organization is suspended");
    this.name = "OrgSuspendedError";
  }
}

export const createContext = async () => {
  const session = await auth();
  let ipAddress: string | null = null;
  try {
    const hdrs = await headers();
    ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
      || hdrs.get("x-real-ip")
      || null;
  } catch {
    // headers() may fail outside request context
  }

  let organizationId: string = DEFAULT_ORG_ID;
  let orgMemberRole: OrgMemberRole | null = null;
  if (session?.user?.id) {
    const membership = await prisma.orgMember.findFirst({
      where: {
        userId: session.user.id,
        // Prefer any real org over the OSS default backfill row.
        // If the user only has the default membership, fall through to it.
        NOT: { organizationId: DEFAULT_ORG_ID },
      },
      select: { organizationId: true, role: true },
      orderBy: { createdAt: "desc" },
    }) ?? await prisma.orgMember.findFirst({
      where: { userId: session.user.id },
      select: { organizationId: true, role: true },
    });
    if (membership) {
      organizationId = membership.organizationId;
      orgMemberRole = membership.role;
    }
  }

  return { session, ipAddress, organizationId, orgMemberRole };
};

/**
 * Request-level suspension probe.
 *
 * The `responseMeta` HTTP-status override on the fetch adapter only
 * works for non-streaming clients (httpLink / httpBatchLink). The app's
 * production client uses `httpBatchStreamLink` which establishes the
 * response status before procedures run, then encodes per-procedure
 * errors inside the JSON stream — `responseMeta`'s `errors[]` is empty
 * at the time it's called for streaming requests so it can't see the
 * orgProcedure throw.
 *
 * To cover both client shapes the tRPC route handler calls this helper
 * BEFORE handing off to `fetchRequestHandler` and returns a 423 directly
 * when the caller's org is suspended. The orgProcedure middleware still
 * throws (defence in depth: a request that somehow bypasses the
 * route-level check is still rejected at the procedure boundary).
 */
export async function isCallerOrgSuspended(): Promise<{
  suspended: boolean;
  deleted: boolean;
}> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { suspended: false, deleted: false };

  // Resolve the caller's org the same way `createContext` does, but
  // without touching the rest of the ctx graph.
  const membership =
    (await prisma.orgMember.findFirst({
      where: { userId, NOT: { organizationId: DEFAULT_ORG_ID } },
      select: { organizationId: true },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.orgMember.findFirst({
      where: { userId },
      select: { organizationId: true },
    }));
  const organizationId = membership?.organizationId ?? DEFAULT_ORG_ID;

  // OSS default org never suspends or deletes — bail out early.
  if (organizationId === DEFAULT_ORG_ID) {
    return { suspended: false, deleted: false };
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true, deletedAt: true },
  });
  // Preserve `orgProcedure`'s precedence: deleted org wins over suspended
  // so the request returns NOT_FOUND (404), not Locked (423). Same rule
  // is documented in `src/lib/org-constraints.ts`.
  if (!org || org.deletedAt) {
    return { suspended: false, deleted: true };
  }
  return { suspended: Boolean(org.suspendedAt), deleted: false };
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { session: ctx.session },
  });
});

export const orgProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // organizationId is already in ctx from createContext
  // Skip the suspension check for the OSS default org
  if (ctx.organizationId !== DEFAULT_ORG_ID) {
    const org = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { suspendedAt: true, deletedAt: true },
    });
    if (!org || org.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
    if (org.suspendedAt)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization is suspended",
        cause: new OrgSuspendedError(),
      });
  }
  // Run the rest of the procedure inside the per-org log context so
  // every infoLog/warnLog/errorLog inside picks up `{org=<id>}` via
  // AsyncLocalStorage. The wrapper is keyed on
  // `ctx.organizationId` so a procedure for the OSS default org still
  // emits the segment for trace continuity.
  return runWithLogContext({ orgId: ctx.organizationId }, () =>
    next({ ctx: { ...ctx, organizationId: ctx.organizationId } }),
  );
});

const roleLevel: Record<Role, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
};

/**
 * Resolve the team that owns `pipelineIds` and require the batch to be
 * single-team. scopes the lookup by `organizationId` so a
 * Prisma bug (or future refactor) cannot accidentally return a
 * cross-org pipeline whose teamId the batch would then validate against.
 */
async function resolvePipelineBatchTeamId(
  pipelineIds: string[],
  organizationId: string,
) {
  const uniquePipelineIds = [...new Set(pipelineIds)];
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: uniquePipelineIds }, organizationId },
    select: {
      id: true,
      environment: { select: { teamId: true } },
    },
  });

  if (pipelines.length !== uniquePipelineIds.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
  }

  const teamIds = new Set(pipelines.map((pipeline) => pipeline.environment.teamId));
  if (teamIds.size !== 1 || teamIds.has(null)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Pipeline batch must contain pipelines from exactly one team",
    });
  }

  return [...teamIds][0]!;
}

export const requireRole = (minRole: Role) =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // Get the user's highest role across all team memberships
    const memberships = await prisma.teamMember.findMany({
      where: { userId },
      select: { role: true },
    });

    if (memberships.length === 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of any team",
      });
    }

    const highestRole = memberships.reduce<Role>((best, m) =>
      roleLevel[m.role] > roleLevel[best] ? m.role : best,
      memberships[0].role,
    );

    if (roleLevel[highestRole] < roleLevel[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires ${minRole} role or higher`,
      });
    }

    return next({
      ctx: { session: ctx.session, userRole: highestRole },
    });
  });

/**
 * Per-organisation admin authorization middleware. The org-scoped
 * counterpart to `requirePlatformOperator`: an OrgMember whose role is
 * OWNER or ADMIN of the caller's resolved organisation passes.
 *
 * Per-org settings (OIDC, sub-processor notice email, etc.) were previously gated behind
 * `requirePlatformOperator()` which forced VectorFlow staff to mutate
 * customer-owned settings on the customer's behalf — violating the
 * "operators are NEVER tenant Users" boundary and breaking self-service
 * SSO setup for cloud customers. This gate restores org-level control
 * to org OWNERs/ADMINs while still being a defense-in-depth barrier in
 * front of mutations (the per-procedure validation — e.g. the OIDC
 * domain-claim gate — remains).
 */
export const requireOrgAdmin = () =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const ok = await isOrgWideAdmin(ctx.session.user.id, ctx.organizationId);
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This action requires an organisation OWNER or ADMIN role",
      });
    }
    return next({
      ctx: { ...ctx, session: ctx.session, userRole: "ADMIN" as Role },
    });
  });

/**
 * Platform-operator authorization middleware.
 *
 * The platform-operator boundary is a hard line: operators are NEVER
 * tenant Users. The legacy `User.isSuperAdmin` hatch blurred that line
 * and was dropped (slice 7c). `requirePlatformOperator(role)` is the
 * only operator gate.
 *
 * Resolution:
 *   1. The caller MUST have a session (UNAUTHORIZED otherwise).
 *   2. The session user's email MUST match a `PlatformOperator` row.
 *      Under strict multi-tenant, operators sign in via a separate
 *      auth surface (operator subdomain, WebAuthn-only) so the User
 *      row that lands in the session is the operator's identity, not
 *      a tenant identity.
 *   3. The operator's `PlatformOperatorRole` MUST be at or above
 *      `minRole`. Roles are ranked: SUPPORT (0) < BILLING (1) <
 *      INFRA (2) < INCIDENT (3). Promote-narrowness rather than
 *      role-widening: an INCIDENT operator passes a SUPPORT gate, but
 *      not vice versa.
 *
 * History: introduced alongside the legacy `requireSuperAdmin` middleware
 * during the platform-operator boundary migration; the legacy middleware
 * and its `User.isSuperAdmin` reader were removed once every callsite had
 * been flipped to this gate (slice 7c).
 *
 * Operator threading: the resolved `PlatformOperator` row is placed on
 * `ctx.operator` so downstream handlers can attribute writes to the
 * operator without re-querying the table.
 */
const PLATFORM_OPERATOR_ROLE_RANK: Record<PlatformOperatorRole, number> = {
  SUPPORT: 0,
  BILLING: 1,
  INFRA: 2,
  INCIDENT: 3,
};

export const requirePlatformOperator = (minRole: PlatformOperatorRole = "SUPPORT") =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const email = ctx.session.user.email;
    if (!email) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const operator = await prisma.platformOperator.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, deletedAt: true },
    });
    if (!operator) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This action requires a platform operator session",
      });
    }
    if (operator.deletedAt) {
      // Soft-deleted operator (PlatformOperator.deletedAt set out of
      // band when decommissioning the operator). Audit-log entries
      // remain; the session no longer authorises operator actions.
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Operator account is decommissioned",
      });
    }

    const minRank = PLATFORM_OPERATOR_ROLE_RANK[minRole];
    const haveRank = PLATFORM_OPERATOR_ROLE_RANK[operator.role];
    if (haveRank < minRank) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires platform operator role ${minRole} or higher`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
        operator,
        // Keep userRole=ADMIN for backward compat with downstream handlers
        // that still read `userRole` (the team RBAC field). Operator
        // procedures bypass team membership, so the value is nominal.
        userRole: "ADMIN" as Role,
      },
    });
  });

/**
 * Team-scoped authorization middleware.
 * Resolves teamId from procedure input, validates membership, checks role.
 * Org-wide admins (OrgMember role OWNER or ADMIN) bypass the membership
 * check — they're treated as ADMIN of every team in their org.
 */
export const withTeamAccess = (minRole: Role) =>
  t.middleware(async ({ ctx, getRawInput, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const rawInput = (await getRawInput()) as Record<string, unknown> | undefined;

    // When pipelineIds is present we must resolve teamId from DB — never trust the caller-supplied
    // teamId because a caller could inject an authorized teamId while supplying pipeline IDs from a
    // different team, bypassing the per-batch validation below.
    const hasPipelineIds =
      Array.isArray(rawInput?.pipelineIds) && (rawInput.pipelineIds as string[]).length > 0;
    let teamId: string | undefined = hasPipelineIds
      ? undefined
      : (rawInput?.teamId as string | undefined);

    if (!teamId && rawInput?.environmentId) {
      const env = await prisma.environment.findUnique({
        where: { id: rawInput.environmentId as string },
        select: { teamId: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      teamId = env.teamId ?? undefined;
    }

    if (!teamId && rawInput?.pipelineId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: rawInput.pipelineId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }
      teamId = pipeline.environment.teamId ?? undefined;
    }

    // Resolve teamId from pipelineIds array and reject mixed-team batches before handlers run.
    // hasPipelineIds is always true here when pipelineIds were present (teamId was left undefined above).
    if (hasPipelineIds && !teamId) {
      teamId = await resolvePipelineBatchTeamId(rawInput!.pipelineIds as string[], ctx.organizationId);
    }

    // Resolve teamId from upstreamId (pipeline dependency endpoints)
    if (!teamId && rawInput?.upstreamId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: rawInput.upstreamId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (pipeline) {
        teamId = pipeline.environment.teamId ?? undefined;
      }
    }

    // Fallback: try input.id as various entity types
    if (!teamId && rawInput?.id) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (pipeline) {
        teamId = pipeline.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const env = await prisma.environment.findUnique({
        where: { id: rawInput.id as string },
        select: { teamId: true },
      });
      if (env) {
        teamId = env.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const node = await prisma.vectorNode.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (node) {
        teamId = node.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const template = await prisma.template.findUnique({
        where: { id: rawInput.id as string },
        select: { teamId: true },
      });
      if (template?.teamId) {
        teamId = template.teamId;
      }
    }

    if (!teamId && rawInput?.id) {
      const alertRule = await prisma.alertRule.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (alertRule) {
        teamId = alertRule.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const pipelineGroup = await prisma.pipelineGroup.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (pipelineGroup) {
        teamId = pipelineGroup.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const nodeGroup = await prisma.nodeGroup.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (nodeGroup) {
        teamId = nodeGroup.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const notifChannel = await prisma.notificationChannel.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (notifChannel) {
        teamId = notifChannel.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const sharedComponent = await prisma.sharedComponent.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (sharedComponent) {
        teamId = sharedComponent.environment.teamId ?? undefined;
      }
    }

    // Resolve requestId → EventSampleRequest → pipeline → environment.teamId
    if (!teamId && rawInput?.requestId) {
      const req = await prisma.eventSampleRequest.findUnique({
        where: { id: rawInput.requestId as string },
        select: { pipeline: { select: { environment: { select: { teamId: true } } } } },
      });
      if (req) {
        teamId = req.pipeline.environment.teamId ?? undefined;
      }
    }

    // Resolve requestId → DeployRequest → environment.teamId
    if (!teamId && rawInput?.requestId) {
      const deployReq = await prisma.deployRequest.findUnique({
        where: { id: rawInput.requestId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (deployReq) {
        teamId = deployReq.environment.teamId ?? undefined;
      }
    }

    // Resolve requestId → PromotionRequest → sourceEnvironment.teamId
    if (!teamId && rawInput?.requestId) {
      const promoReq = await prisma.promotionRequest.findUnique({
        where: { id: rawInput.requestId as string },
        select: { sourceEnvironment: { select: { teamId: true } } },
      });
      if (promoReq) {
        teamId = promoReq.sourceEnvironment.teamId ?? undefined;
      }
    }

    // Resolve versionId → PipelineVersion → pipeline → environment.teamId
    if (!teamId && rawInput?.versionId) {
      const version = await prisma.pipelineVersion.findUnique({
        where: { id: rawInput.versionId as string },
        select: { pipeline: { select: { environment: { select: { teamId: true } } } } },
      });
      if (version) {
        teamId = version.pipeline.environment.teamId ?? undefined;
      }
    }

    // Resolve alertEventId → AlertEvent → AlertRule → environment.teamId
    if (!teamId && rawInput?.alertEventId) {
      const alertEvent = await prisma.alertEvent.findUnique({
        where: { id: rawInput.alertEventId as string },
        select: { alertRule: { select: { environment: { select: { teamId: true } } } } },
      });
      if (alertEvent) {
        teamId = alertEvent.alertRule.environment.teamId ?? undefined;
      }
    }

    // Resolve nodeId → VectorNode → environment.teamId (for fleet.nodeLogs, fleet.nodeMetrics)
    if (!teamId && rawInput?.nodeId) {
      const node = await prisma.vectorNode.findUnique({
        where: { id: rawInput.nodeId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (node) {
        teamId = node.environment.teamId ?? undefined;
      }
    }

    // Resolve rolloutId → StagedRollout → environment.teamId
    // (for stagedRollout.broaden / stagedRollout.rollback)
    if (!teamId && rawInput?.rolloutId) {
      const rollout = await prisma.stagedRollout.findUnique({
        where: { id: rawInput.rolloutId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (rollout) {
        teamId = rollout.environment.teamId ?? undefined;
      }
    }

    // Resolve jobId → GitSyncJob → environment.teamId (for gitSync.retryJob)
    if (!teamId && rawInput?.jobId) {
      const job = await prisma.gitSyncJob.findUnique({
        where: { id: rawInput.jobId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (job) {
        teamId = job.environment.teamId ?? undefined;
      }
    }

    // Resolve deliveryAttemptId → DeliveryAttempt → alertEvent → alertRule.teamId
    // (for alert.retryDelivery)
    if (!teamId && rawInput?.deliveryAttemptId) {
      const attempt = await prisma.deliveryAttempt.findUnique({
        where: { id: rawInput.deliveryAttemptId as string },
        select: { alertEvent: { select: { alertRule: { select: { teamId: true } } } } },
      });
      if (attempt) {
        teamId = attempt.alertEvent.alertRule.teamId ?? undefined;
      }
    }

    // Resolve id as ServiceAccount → environment.teamId
    if (!teamId && rawInput?.id) {
      const sa = await prisma.serviceAccount.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (sa) {
        teamId = sa.environment.teamId ?? undefined;
      }
    }

    // Resolve id as VrlSnippet → teamId (for vrl-snippet update/delete)
    if (!teamId && rawInput?.id) {
      const snippet = await prisma.vrlSnippet.findUnique({
        where: { id: rawInput.id as string },
        select: { teamId: true },
      });
      if (snippet) {
        teamId = snippet.teamId;
      }
    }

    // Resolve id as AlertCorrelationGroup → environment.teamId
    if (!teamId && rawInput?.id) {
      const correlationGroup = await prisma.alertCorrelationGroup.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (correlationGroup) {
        teamId = correlationGroup.environment.teamId ?? undefined;
      }
    }

    // Resolve groupId → AlertCorrelationGroup → environment.teamId
    if (!teamId && rawInput?.groupId) {
      const correlationGroup = await prisma.alertCorrelationGroup.findUnique({
        where: { id: rawInput.groupId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (correlationGroup) {
        teamId = correlationGroup.environment.teamId ?? undefined;
      }
    }

    // Resolve id as Team → teamId (for team.get)
    if (!teamId && rawInput?.id) {
      const team = await prisma.team.findUnique({
        where: { id: rawInput.id as string },
        select: { id: true },
      });
      if (team) {
        teamId = team.id;
      }
    }

    if (!teamId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot resolve team context from input",
      });
    }

    // Resolve team org for boundary check; fetch in parallel with the
    // org-wide admin check so the round-trips overlap. Org-wide admins
    // (OrgMember role OWNER or ADMIN) bypass the membership lookup —
    // they're admins of every team in their org.
    const [isOrgAdmin, teamOrg] = await Promise.all([
      isOrgWideAdmin(userId, ctx.organizationId),
      prisma.team.findUnique({
        where: { id: teamId },
        select: { organizationId: true },
      }),
    ]);

    // Org-boundary check: don't leak cross-org team existence.
    //
    // NOTE (VF-44, by design): in OSS single-tenant mode the boundary check is
    // intentionally skipped when ctx.organizationId === DEFAULT_ORG_ID. Users
    // without a real OrgMember row keep the DEFAULT_ORG_ID context (see
    // createContext), and every team in a single-tenant install lives under that
    // default org, so skipping keeps all teams reachable in OSS.
    //
    // On STRICT multi-tenant deployments (VF_STRICT_MULTI_TENANT=true) the skip
    // is closed: a real tenant must never resolve to DEFAULT_ORG_ID, so if a
    // request ever does, enforce the boundary rather than fall open. Do not
    // remove the OSS path without re-evaluating single-tenant reachability.
    if (
      (isStrictMultiTenantMode() || ctx.organizationId !== DEFAULT_ORG_ID) &&
      teamOrg?.organizationId !== ctx.organizationId
    ) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    if (isOrgAdmin) {
      return next({
        ctx: { session: ctx.session, teamId, userRole: "ADMIN" as Role },
      });
    }

    // Check membership and role in this specific team
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });

    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this team",
      });
    }

    if (roleLevel[membership.role] < roleLevel[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires ${minRole} role or higher in this team`,
      });
    }

    return next({
      ctx: { session: ctx.session, teamId, userRole: membership.role },
    });
  });

export const middleware = t.middleware;

/**
 * Block a procedure when running in hosted demo mode (NEXT_PUBLIC_VF_DEMO_MODE=true).
 * Apply to mutations that change identity surface (users, service accounts, OIDC,
 * SCIM, backups, webhook endpoints) so the public demo cannot mint credentials,
 * exfiltrate data, or escalate privileges.
 */
export const denyInDemo = () =>
  t.middleware(({ next }) => {
    if (isDemoMode()) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This action is disabled in the public demo.",
      });
    }
    return next();
  });

export { roleLevel };
