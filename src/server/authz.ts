import { TRPCError } from "@trpc/server";
import type { Role } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { roleLevel } from "@/trpc/init";
import { isOrgWideAdmin } from "@/lib/org-admin";

/**
 * Asserts the caller has at least `minRole` on the (single) team
 * resolved from the pipeline batch.
 *
 * Phase 7a (audit gap): the legacy `User.isSuperAdmin` global-admin
 * shortcut is gone — callers now elevate via `isOrgWideAdmin` against
 * the org. The optional `organizationId` argument is accepted for
 * future strict-multi-tenant callers (every protectedProcedure ctx
 * carries it). When omitted, `isOrgWideAdmin` falls back to the
 * single-tenant DEFAULT_ORG_ID, preserving OSS behaviour.
 */
export async function assertPipelineBatchAccess(
  pipelineIds: string[],
  userId: string,
  minRole: Role,
  organizationId?: string,
) {
  const uniquePipelineIds = [...new Set(pipelineIds)];
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: uniquePipelineIds } },
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

  const teamId = [...teamIds][0]!;

  // Codex PR #380 round-2 P1 — `withTeamAccess` (src/trpc/init.ts)
  // still honours `User.isSuperAdmin` as a back-compat hatch until
  // slice 7c drops the column. If we elevate ONLY via
  // `isOrgWideAdmin` here, a legacy super-admin without an OrgMember
  // row passes the upstream middleware but gets rejected here as
  // FORBIDDEN. Keep the legacy fallback in lockstep with init.ts so
  // mixed-state callers behave consistently across this slice.
  if (await isOrgWideAdmin(userId, organizationId)) {
    return { teamId, userRole: "ADMIN" as Role };
  }
  const legacy = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });
  if (legacy?.isSuperAdmin) {
    return { teamId, userRole: "ADMIN" as Role };
  }

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

  return { teamId, userRole: membership.role };
}
