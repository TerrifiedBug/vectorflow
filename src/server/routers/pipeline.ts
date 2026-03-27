import { join } from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, requireSuperAdmin } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { ComponentKind, LogLevel } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import {
  createVersion,
  listVersions,
  listVersionsSummary,
  getVersion,
  rollback,
} from "@/server/services/pipeline-version";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { getOrCreateSystemEnvironment } from "@/server/services/system-environment";
import { saveGraphComponents, promotePipeline, discardPipelineChanges, detectConfigChanges, listPipelinesForEnvironment } from "@/server/services/pipeline-graph";
import { copyPipelineGraph } from "@/server/services/copy-pipeline-graph";
import { gitSyncDeletePipeline } from "@/server/services/git-sync";
import { deployAgent, undeployAgent } from "@/server/services/deploy-agent";
import { evaluatePipelineHealth } from "@/server/services/sli-evaluator";
import { batchEvaluatePipelineHealth } from "@/server/services/batch-health";
import { relayPush } from "@/server/services/push-broadcast";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { fireEventAlert } from "@/server/services/event-alerts";

/** Pipeline names must be safe identifiers */
const pipelineNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/,
    "Pipeline name must start with a letter or number and contain only letters, numbers, spaces, hyphens, and underscores",
  );

const nodeSchema = z.object({
  id: z.string().optional(),
  componentKey: z.string().min(1).max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  displayName: z.string().max(64).nullable().optional(),
  componentType: z.string().min(1),
  kind: z.nativeEnum(ComponentKind),
  config: z.record(z.string(), z.any()),
  positionX: z.number(),
  positionY: z.number(),
  disabled: z.boolean().default(false),
  sharedComponentId: z.string().nullable().optional(),
  sharedComponentVersion: z.number().nullable().optional(),
});

const edgeSchema = z.object({
  id: z.string().optional(),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sourcePort: z.string().optional(),
});

export const pipelineRouter = router({
  getSystemPipeline: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      const pipeline = await prisma.pipeline.findFirst({
        where: { isSystem: true },
        select: { id: true, name: true, isDraft: true, deployedAt: true },
      });
      return pipeline; // null if no system pipeline exists
    }),

  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listPipelinesForEnvironment(input.environmentId);
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

      // Compare current config against the deployed version
      let hasConfigChanges = false;
      let deployedVersionNumber: number | null = null;
      if (!pipeline.isDraft && pipeline.deployedAt) {
        const latestVersion = await prisma.pipelineVersion.findFirst({
          where: { pipelineId: input.id },
          orderBy: { version: "desc" },
          select: { configYaml: true, logLevel: true, version: true },
        });

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
    // withAudit works without withTeamAccess — teamId/environmentId will be null
    // which is expected for system-level operations
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
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.updated", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const { id, tags, enrichMetadata, groupId, autoRollbackEnabled, autoRollbackThreshold, autoRollbackWindowMinutes, ...data } = input;
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

      // Validate tags against the team's available tags
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

      // Validate groupId belongs to the same environment as the pipeline
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

      // Undeploy before deleting so agents stop the pipeline on next poll
      if (existing.deployedAt) {
        await prisma.pipeline.update({
          where: { id: input.id },
          data: { isDraft: true, deployedAt: null },
        });
      }

      // Git sync: delete pipeline YAML from repo (non-blocking)
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
          console.error("[git-sync] Delete failed for pipeline:", existing.name, err);
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

  saveGraph: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        nodes: z.array(nodeSchema),
        edges: z.array(edgeSchema),
        globalConfig: z.record(z.string().max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/), z.any()).nullable().optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.graph_saved", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      // Set audit metadata summary — this side-effect MUST stay in the router
      const nodeTypes = input.nodes.map((n) => `${n.kind.toLowerCase()}:${n.componentType}`);
      (ctx as Record<string, unknown>).auditMetadata = {
        pipelineId: input.pipelineId,
        nodeCount: input.nodes.length,
        edgeCount: input.edges.length,
        nodeTypes: [...new Set(nodeTypes)],
      };

      return prisma.$transaction(async (tx) => {
        return saveGraphComponents(tx, {
          pipelineId: input.pipelineId,
          nodes: input.nodes,
          edges: input.edges,
          globalConfig: input.globalConfig,
          userId: ctx.session.user?.id ?? null,
        });
      });
    }),

  discardChanges: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.changes_discarded", "Pipeline"))
    .mutation(async ({ input }) => {
      return discardPipelineChanges(input.pipelineId);
    }),

  versions: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listVersions(input.pipelineId);
    }),

  versionsSummary: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listVersionsSummary(input.pipelineId);
    }),

  createVersion: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        configYaml: z.string().min(1),
        changelog: z.string().optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { globalConfig: true, nodes: true, edges: true },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }
      const logLevel = (pipeline.globalConfig as Record<string, unknown>)?.log_level as string ?? null;

      const nodesSnapshot = pipeline.nodes.map((n) => ({
        id: n.id,
        componentKey: n.componentKey,
        displayName: n.displayName,
        componentType: n.componentType,
        kind: n.kind,
        config: n.config,
        positionX: n.positionX,
        positionY: n.positionY,
        disabled: n.disabled,
        sharedComponentId: n.sharedComponentId ?? null,
        sharedComponentVersion: n.sharedComponentVersion ?? null,
      }));
      const edgesSnapshot = pipeline.edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourcePort: e.sourcePort,
      }));

      return createVersion(
        input.pipelineId,
        input.configYaml,
        userId,
        input.changelog,
        logLevel,
        pipeline.globalConfig as Record<string, unknown> | null,
        nodesSnapshot,
        edgesSnapshot,
      );
    }),

  getVersion: protectedProcedure
    .input(z.object({ versionId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getVersion(input.versionId);
    }),

  rollback: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        targetVersionId: z.string(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.rollback", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const version = await rollback(input.pipelineId, input.targetVersionId, userId);

      // Notify connected agents and browsers about the rollback (non-fatal side effect)
      try {
        const pipeline = await prisma.pipeline.findUnique({
          where: { id: input.pipelineId },
          select: { name: true, environmentId: true, nodeSelector: true },
        });
        if (pipeline) {
          const nodeSelector = pipeline.nodeSelector as Record<string, string> | null;
          const targetNodes = await prisma.vectorNode.findMany({
            where: { environmentId: pipeline.environmentId },
            select: { id: true, labels: true },
          });
          for (const node of targetNodes) {
            const labels = (node.labels as Record<string, string>) ?? {};
            const selectorEntries = Object.entries(nodeSelector ?? {});
            const matches = selectorEntries.every(([k, v]) => labels[k] === v);
            if (matches) {
              relayPush(node.id, {
                type: "config_changed",
                pipelineId: input.pipelineId,
                reason: "rollback",
              });
            }
          }

          broadcastSSE({
            type: "status_change",
            nodeId: "",
            fromStatus: "",
            toStatus: "DEPLOYED",
            reason: "rollback",
            pipelineId: input.pipelineId,
            pipelineName: pipeline.name,
          }, pipeline.environmentId);

          void fireEventAlert("deploy_completed", pipeline.environmentId, {
            message: `Pipeline "${pipeline.name}" rolled back`,
            pipelineId: input.pipelineId,
          });
        }
      } catch (err) {
        console.error("[rollback] Push/SSE notification failed:", err);
      }

      return version;
    }),

  deploymentStatus: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { version: true },
          },
        },
      });

      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const latestVersion = pipeline.versions[0]?.version ?? 0;

      const statuses = await prisma.nodePipelineStatus.findMany({
        where: { pipelineId: input.pipelineId },
        include: {
          node: {
            select: {
              id: true,
              name: true,
              host: true,
              status: true,
              lastHeartbeat: true,
            },
          },
        },
      });

      return {
        latestVersion,
        deployed: !pipeline.isDraft,
        nodes: statuses.map((s) => ({
          nodeId: s.node.id,
          nodeName: s.node.name,
          nodeHost: s.node.host,
          nodeStatus: s.node.status,
          pipelineStatus: s.status,
          runningVersion: s.version,
          isLatest: s.version === latestVersion,
          uptimeSeconds: s.uptimeSeconds,
          lastUpdated: s.lastUpdated,
        })),
      };
    }),

  metrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        hours: z.number().min(1).max(168).default(24),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

      return prisma.pipelineMetric.findMany({
        where: {
          pipelineId: input.pipelineId,
          nodeId: null,
          componentId: null,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "asc" },
        select: {
          timestamp: true,
          eventsIn: true,
          eventsOut: true,
          eventsDiscarded: true,
          errorsTotal: true,
          bytesIn: true,
          bytesOut: true,
          utilization: true,
          latencyMeanMs: true,
        },
      });
    }),

  logs: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
        levels: z.array(z.nativeEnum(LogLevel)).optional(),
        nodeId: z.string().optional(),
        since: z.date().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { pipelineId, cursor, limit, levels, nodeId, since } = input;
      const take = limit;

      const where: Record<string, unknown> = { pipelineId };
      if (levels && levels.length > 0) {
        where.level = { in: levels };
      }
      if (nodeId) {
        where.nodeId = nodeId;
      }
      if (since) {
        where.timestamp = { gte: since };
      }

      const items = await prisma.pipelineLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          node: { select: { name: true } },
          pipeline: { select: { name: true } },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > take) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return { items, nextCursor };
    }),

  requestSamples: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        componentKeys: z.array(z.string()),
        limit: z.number().min(1).max(50).default(5),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { id: true, isDraft: true, deployedAt: true },
      });
      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      if (pipeline.isDraft || !pipeline.deployedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Pipeline must be deployed to sample events",
        });
      }

      const request = await prisma.eventSampleRequest.create({
        data: {
          pipelineId: input.pipelineId,
          componentKeys: input.componentKeys,
          limit: input.limit,
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
      });

      // Push sample request to connected agents running this pipeline
      const statuses = await prisma.nodePipelineStatus.findMany({
        where: { pipelineId: input.pipelineId, status: "RUNNING" },
        select: { nodeId: true },
      });
      for (const { nodeId } of statuses) {
        relayPush(nodeId, {
          type: "sample_request",
          requestId: request.id,
          pipelineId: input.pipelineId,
          componentKeys: input.componentKeys,
          limit: input.limit,
        });
      }

      return { requestId: request.id, status: "PENDING" };
    }),

  sampleResult: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const request = await prisma.eventSampleRequest.findUnique({
        where: { id: input.requestId },
        include: {
          samples: {
            select: {
              id: true,
              componentKey: true,
              events: true,
              schema: true,
              error: true,
              sampledAt: true,
            },
          },
        },
      });
      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sample request not found",
        });
      }

      return {
        requestId: request.id,
        status: request.status,
        samples: request.samples,
      };
    }),

  eventSchemas: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .query(async ({ input }) => {
      const samples = await prisma.eventSample.findMany({
        where: {
          pipelineId: input.pipelineId,
          error: null,
        },
        orderBy: { sampledAt: "desc" },
        select: {
          componentKey: true,
          schema: true,
          events: true,
          sampledAt: true,
        },
      });

      // Deduplicate: keep only the most recent sample per componentKey
      const seen = new Set<string>();
      const deduplicated = [];
      for (const sample of samples) {
        if (!seen.has(sample.componentKey)) {
          seen.add(sample.componentKey);
          deduplicated.push(sample);
        }
      }

      return deduplicated;
    }),

  listSlis: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.pipelineSli.findMany({
        where: { pipelineId: input.pipelineId },
        orderBy: { createdAt: "asc" },
      });
    }),

  upsertSli: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        metric: z.enum(["error_rate", "throughput_floor", "discard_rate"]),
        condition: z.enum(["lt", "gt"]),
        threshold: z.number().min(0),
        windowMinutes: z.number().int().min(1).max(1440).default(5),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.sli_upserted", "Pipeline"))
    .mutation(async ({ input }) => {
      return prisma.pipelineSli.upsert({
        where: {
          pipelineId_metric: {
            pipelineId: input.pipelineId,
            metric: input.metric,
          },
        },
        update: {
          condition: input.condition,
          threshold: input.threshold,
          windowMinutes: input.windowMinutes,
        },
        create: {
          pipelineId: input.pipelineId,
          metric: input.metric,
          condition: input.condition,
          threshold: input.threshold,
          windowMinutes: input.windowMinutes,
        },
      });
    }),

  deleteSli: protectedProcedure
    .input(z.object({ id: z.string(), pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.sli_deleted", "Pipeline"))
    .mutation(async ({ input }) => {
      const sli = await prisma.pipelineSli.findUnique({
        where: { id: input.id },
      });
      if (!sli || sli.pipelineId !== input.pipelineId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SLI not found",
        });
      }
      return prisma.pipelineSli.delete({
        where: { id: input.id },
      });
    }),

  health: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return evaluatePipelineHealth(input.pipelineId);
    }),

  batchHealth: protectedProcedure
    .input(z.object({ pipelineIds: z.array(z.string()).max(200) }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return batchEvaluatePipelineHealth(input.pipelineIds);
    }),

  // ── Bulk operations ─────────────────────────────────────────────────────

  bulkDeploy: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(50),
        changelog: z.string().min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const result = await deployAgent(pipelineId, userId, input.changelog);
          results.push({ pipelineId, success: result.success, error: result.error });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),

  bulkUndeploy: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(50),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const result = await undeployAgent(pipelineId);
          results.push({ pipelineId, success: result.success, error: result.error });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),

  bulkDelete: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(50),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .mutation(async ({ input }) => {
      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const pipeline = await prisma.pipeline.findUnique({
            where: { id: pipelineId },
            select: { id: true, isSystem: true, deployedAt: true, environmentId: true },
          });

          if (!pipeline) {
            results.push({ pipelineId, success: false, error: "Pipeline not found" });
            continue;
          }

          if (pipeline.isSystem) {
            results.push({ pipelineId, success: false, error: "Cannot delete system pipeline" });
            continue;
          }

          // Undeploy first if deployed
          if (pipeline.deployedAt) {
            await prisma.pipeline.update({
              where: { id: pipelineId },
              data: { isDraft: true, deployedAt: null },
            });
          }

          await prisma.pipeline.delete({ where: { id: pipelineId } });
          results.push({ pipelineId, success: true });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),

  bulkAddTags: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(100),
        tags: z.array(z.string()).min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      // Validate tags against team.availableTags ONCE before the loop
      // Get the team from the first pipeline's environment
      const firstPipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineIds[0] },
        select: { environment: { select: { teamId: true } } },
      });
      if (!firstPipeline?.environment.teamId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline or team not found" });
      }
      const team = await prisma.team.findUnique({
        where: { id: firstPipeline.environment.teamId },
        select: { availableTags: true },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      const availableTags = (team.availableTags as string[]) ?? [];
      if (availableTags.length > 0) {
        const invalid = input.tags.filter((t) => !availableTags.includes(t));
        if (invalid.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid tags: ${invalid.join(", ")}. Tags must be defined in team settings first.`,
          });
        }
      }

      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const pipeline = await prisma.pipeline.findUnique({
            where: { id: pipelineId },
            select: { id: true, tags: true },
          });
          if (!pipeline) {
            results.push({ pipelineId, success: false, error: "Pipeline not found" });
            continue;
          }
          const existingTags = (pipeline.tags as string[]) ?? [];
          const merged = [...new Set([...existingTags, ...input.tags])];
          await prisma.pipeline.update({
            where: { id: pipelineId },
            data: { tags: merged },
          });
          results.push({ pipelineId, success: true });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),

  bulkRemoveTags: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(100),
        tags: z.array(z.string()).min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const pipeline = await prisma.pipeline.findUnique({
            where: { id: pipelineId },
            select: { id: true, tags: true },
          });
          if (!pipeline) {
            results.push({ pipelineId, success: false, error: "Pipeline not found" });
            continue;
          }
          const existingTags = (pipeline.tags as string[]) ?? [];
          const filtered = existingTags.filter((t) => !input.tags.includes(t));
          await prisma.pipeline.update({
            where: { id: pipelineId },
            data: { tags: filtered },
          });
          results.push({ pipelineId, success: true });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),
});
