import { join } from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, requireSuperAdmin } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { deploymentStrategySchema } from "@/lib/deployment-strategy";
import { withAudit } from "@/server/middleware/audit";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { getOrCreateSystemEnvironment } from "@/server/services/system-environment";
import { promotePipeline, detectConfigChanges, listPipelinesForEnvironment } from "@/server/services/pipeline-graph";
import { copyPipelineGraph } from "@/server/services/copy-pipeline-graph";
import { gitSyncDeletePipeline } from "@/server/services/git-sync";
import { pipelineNameSchema } from "./pipeline-schemas";
import { errorLog } from "@/lib/logger";

export const pipelineCrudRouter = router({
  getSystemPipeline: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      const pipeline = await prisma.pipeline.findFirst({
        where: { isSystem: true },
        select: { id: true, name: true, isDraft: true, deployedAt: true },
      });
      return pipeline;
    }),

  list: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50).optional(),
        search: z.string().optional(),
        status: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        groupId: z.string().optional(),
        sortBy: z.enum(["name", "updatedAt", "deployedAt"]).optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
      })
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { environmentId, ...options } = input;
      return listPipelinesForEnvironment(environmentId, options);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.id },
        include: {
          nodes: {
            include: {
              sharedComponent: {
                select: { name: true, version: true },
              },
            },
          },
          edges: true,
          environment: { select: { teamId: true, gitOpsMode: true, name: true } },
          nodeStatuses: {
            select: { status: true, uptimeSeconds: true },
          },
          versions: {
            orderBy: { version: "desc" as const },
            take: 1,
            select: { configYaml: true, logLevel: true, version: true },
          },
        },
      });
      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      const decryptedNodes = pipeline.nodes.map((n) => ({
        ...n,
        config: decryptNodeConfig(
          n.componentType,
          (n.config as Record<string, unknown>) ?? {},
        ),
      }));

      let hasConfigChanges = false;
      let deployedVersionNumber: number | null = null;
      if (!pipeline.isDraft && pipeline.deployedAt) {
        const latestVersion = pipeline.versions[0] ?? null;
        deployedVersionNumber = latestVersion?.version ?? null;
        hasConfigChanges = detectConfigChanges({
          nodes: decryptedNodes,
          edges: pipeline.edges,
          globalConfig: pipeline.globalConfig as Record<string, unknown> | null,
          enrichMetadata: pipeline.enrichMetadata,
          environmentName: pipeline.environment.name,
          latestVersion,
        });
      }

      return {
        ...pipeline,
        nodes: decryptedNodes,
        hasConfigChanges,
        deployedVersionNumber,
        gitOpsMode: pipeline.environment.gitOpsMode,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: pipelineNameSchema,
        description: z.string().optional(),
        environmentId: z.string(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.created", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const environment = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!environment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      return prisma.pipeline.create({
        data: {
          name: input.name,
          description: input.description,
          environmentId: input.environmentId,
          globalConfig: { log_level: "info" },
          createdById: ctx.session.user?.id ?? null,
          updatedById: ctx.session.user?.id ?? null,
        },
      });
    }),

  createSystemPipeline: protectedProcedure
    .use(requireSuperAdmin())
    .use(withAudit("pipeline.system_created", "Pipeline"))
    .mutation(async ({ ctx }) => {
      const systemEnv = await getOrCreateSystemEnvironment();

      return prisma.$transaction(async (tx) => {
        const existing = await tx.pipeline.findFirst({
          where: { isSystem: true },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A system pipeline already exists",
          });
        }

        const pipeline = await tx.pipeline.create({
          data: {
            name: "Audit Log Shipping",
            isSystem: true,
            environmentId: systemEnv.id,
            globalConfig: { log_level: "info" },
            createdById: ctx.session.user?.id ?? null,
          },
        });

        await tx.pipelineNode.create({
          data: {
            pipelineId: pipeline.id,
            componentType: "file",
            kind: "SOURCE",
            componentKey: "audit_log",
            config: {
              include: [
                process.env.VF_AUDIT_LOG_PATH ??
                  join(process.cwd(), ".vectorflow", "audit.jsonl"),
              ],
              read_from: "beginning",
            },
            positionX: 200,
            positionY: 200,
          },
        });

        return pipeline;
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: pipelineNameSchema.optional(),
        description: z.string().nullable().optional(),
        tags: z.array(z.string()).refine(
          (arr) => new Set(arr).size === arr.length,
          { message: "Duplicate tags are not allowed" },
        ).optional(),
        enrichMetadata: z.boolean().optional(),
        groupId: z.string().nullable().optional(),
        autoRollbackEnabled: z.boolean().optional(),
        autoRollbackThreshold: z.number().positive().max(100).optional(),
        autoRollbackWindowMinutes: z.number().int().positive().max(60).optional(),
        deploymentStrategy: deploymentStrategySchema.nullable().optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.updated", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const { id, tags, enrichMetadata, groupId, autoRollbackEnabled, autoRollbackThreshold, autoRollbackWindowMinutes, deploymentStrategy, ...data } = input;
      const existing = await prisma.pipeline.findUnique({
        where: { id },
        select: { id: true, tags: true, environmentId: true, environment: { select: { teamId: true } } },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      if (tags !== undefined) {
        if (!existing.environment.teamId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
        }
        const team = await prisma.team.findUnique({
          where: { id: existing.environment.teamId },
          select: { availableTags: true },
        });
        if (!team) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
        }
        const availableTags = (team.availableTags as string[]) ?? [];
        const existingTags = (existing.tags as string[] | null) ?? [];
        const newlyAdded = tags.filter((t: string) => !existingTags.includes(t));
        const invalid = newlyAdded.filter((t: string) => !availableTags.includes(t));
        if (invalid.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid tags: ${invalid.join(", ")}. Tags must be defined in team settings first.`,
          });
        }
      }

      if (groupId !== undefined && groupId !== null) {
        const group = await prisma.pipelineGroup.findUnique({
          where: { id: groupId },
          select: { environmentId: true },
        });
        if (!group || group.environmentId !== existing.environmentId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pipeline group not found in this environment",
          });
        }
      }

      const updated = await prisma.pipeline.update({
        where: { id },
        data: {
          ...data,
          ...(tags !== undefined ? { tags } : {}),
          ...(enrichMetadata !== undefined ? { enrichMetadata } : {}),
          ...(groupId !== undefined ? { groupId } : {}),
          ...(autoRollbackEnabled !== undefined ? { autoRollbackEnabled } : {}),
          ...(autoRollbackThreshold !== undefined ? { autoRollbackThreshold } : {}),
          ...(autoRollbackWindowMinutes !== undefined ? { autoRollbackWindowMinutes } : {}),
          ...(deploymentStrategy !== undefined
            ? { deploymentStrategy: deploymentStrategy === null ? Prisma.DbNull : deploymentStrategy }
            : {}),
          updatedById: ctx.session.user?.id,
        },
      });

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.deleted", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.pipeline.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "System pipelines cannot be deleted",
        });
      }

      if (existing.deployedAt) {
        await prisma.pipeline.update({
          where: { id: input.id },
          data: { isDraft: true, deployedAt: null },
        });
      }

      const environment = await prisma.environment.findUnique({
        where: { id: existing.environmentId },
      });
      if (environment?.gitRepoUrl && environment?.gitToken) {
        const user = ctx.session?.user;
        const dbUser = user?.id
          ? await prisma.user.findUnique({ where: { id: user.id } })
          : null;
        await gitSyncDeletePipeline(
          {
            repoUrl: environment.gitRepoUrl,
            branch: environment.gitBranch ?? "main",
            encryptedToken: environment.gitToken,
          },
          environment.name,
          existing.name,
          { name: dbUser?.name ?? "VectorFlow User", email: dbUser?.email ?? "noreply@vectorflow" },
        ).catch((err) => {
          errorLog("git-sync", `Delete failed for pipeline: ${existing.name}`, err);
        });
      }

      return prisma.pipeline.delete({
        where: { id: input.id },
      });
    }),

  clone: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.cloned", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const source = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: {
          name: true,
          description: true,
          environmentId: true,
          globalConfig: true,
        },
      });
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      return prisma.$transaction(async (tx) => {
        const cloned = await tx.pipeline.create({
          data: {
            name: `${source.name} (Copy)`,
            description: source.description,
            environmentId: source.environmentId,
            globalConfig: source.globalConfig ?? undefined,
            createdById: ctx.session.user?.id ?? null,
            updatedById: ctx.session.user?.id,
          },
        });

        await copyPipelineGraph(tx, {
          sourcePipelineId: input.pipelineId,
          targetPipelineId: cloned.id,
        });

        return { id: cloned.id, name: cloned.name };
      });
    }),

  promote: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        targetEnvironmentId: z.string(),
        name: pipelineNameSchema.optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.promoted", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      return promotePipeline({
        sourcePipelineId: input.pipelineId,
        targetEnvironmentId: input.targetEnvironmentId,
        name: input.name,
        userId: ctx.session.user?.id ?? null,
      });
    }),
});
