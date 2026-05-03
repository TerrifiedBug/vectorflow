import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { protectedProcedure, router, withTeamAccess } from "@/trpc/init";
import {
  buildComplianceReport,
  evaluateDestinationPolicy,
  summarizeGovernancePosture,
} from "@/server/services/governance";

const sinkPolicySchema = z.object({
  allowedSinkTypes: z.array(z.string().min(1)).optional(),
  deniedSinkTypes: z.array(z.string().min(1)).optional(),
});

export const governanceRouter = router({
  report: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const [pipelines, settings, auditLogCount, auditShippingPipeline, teamMembers] = await Promise.all([
        prisma.pipeline.findMany({
          where: { environment: { teamId: input.teamId } },
          select: {
            id: true,
            name: true,
            tags: true,
            nodes: {
              select: {
                id: true,
                componentKey: true,
                displayName: true,
                componentType: true,
                kind: true,
                config: true,
              },
            },
            edges: {
              select: {
                sourceNodeId: true,
                targetNodeId: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.systemSettings.findUnique({
          where: { id: "singleton" },
          select: { scimEnabled: true, oidcGroupSyncEnabled: true },
        }),
        prisma.auditLog.count({ where: { teamId: input.teamId } }),
        prisma.pipeline.findFirst({
          where: { isSystem: true },
          select: { id: true },
        }),
        prisma.teamMember.findMany({
          where: { teamId: input.teamId },
          select: {
            role: true,
            user: { select: { scimExternalId: true, authMethod: true } },
          },
        }),
      ]);

      const compliance = buildComplianceReport({ pipelines });
      const totalUsers = teamMembers.length;
      const manuallyManagedUsers = teamMembers.filter(
        (member) => !member.user.scimExternalId && member.user.authMethod !== "OIDC",
      ).length;
      const teamsWithAdmins = teamMembers.some((member) => member.role === "ADMIN") ? 1 : 0;

      return {
        compliance,
        posture: summarizeGovernancePosture({
          scimEnabled: settings?.scimEnabled ?? false,
          oidcGroupSyncEnabled: settings?.oidcGroupSyncEnabled ?? false,
          auditLogCount,
          auditShippingConfigured: !!auditShippingPipeline,
          totalUsers,
          manuallyManagedUsers,
          teamsWithAdmins,
          totalTeams: 1,
          protectedSinks: compliance.summary.protectedSinks,
          totalSinks: compliance.summary.sinks,
        }),
      };
    }),

  previewDestinationPolicy: protectedProcedure
    .input(z.object({ pipelineId: z.string() }).merge(sinkPolicySchema))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: {
          id: true,
          nodes: {
            select: {
              componentKey: true,
              componentType: true,
              kind: true,
            },
          },
        },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const sinks = pipeline.nodes
        .filter((node) => node.kind === "SINK")
        .map((node) => ({
          componentKey: node.componentKey,
          componentType: node.componentType,
        }));

      return {
        pipelineId: pipeline.id,
        decisions: evaluateDestinationPolicy({
          sinks,
          policy: {
            allowedSinkTypes: input.allowedSinkTypes,
            deniedSinkTypes: input.deniedSinkTypes,
          },
        }),
      };
    }),
});
