import { join } from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, requireSuperAdmin } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { ComponentKind, LogLevel, Prisma } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import {
  createVersion,
  listVersions,
  getVersion,
  rollback,
} from "@/server/services/pipeline-version";
import { encryptNodeConfig, decryptNodeConfig } from "@/server/services/config-crypto";
import { generateVectorYaml } from "@/lib/config-generator";
import { getOrCreateSystemEnvironment } from "@/server/services/system-environment";
import { copyPipelineGraph } from "@/server/services/copy-pipeline-graph";
import { stripEnvRefs, type StrippedRef } from "@/server/services/strip-env-refs";
import { gitSyncDeletePipeline } from "@/server/services/git-sync";
import { evaluatePipelineHealth } from "@/server/services/sli-evaluator";

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
  componentType: z.string().min(1),
  kind: z.nativeEnum(ComponentKind),
  config: z.record(z.string(), z.any()),
  positionX: z.number(),
  positionY: z.number(),
  disabled: z.boolean().default(false),
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
      const pipelines = await prisma.pipeline.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          name: true,
          description: true,
          isDraft: true,
          deployedAt: true,
          createdAt: true,
          updatedAt: true,
          globalConfig: true,
          tags: true,
          createdBy: { select: { name: true, email: true, image: true } },
          updatedBy: { select: { name: true, email: true, image: true } },
          nodeStatuses: {
            select: {
              status: true,
              eventsIn: true,
              eventsOut: true,
              errorsTotal: true,
              eventsDiscarded: true,
              bytesIn: true,
              bytesOut: true,
            },
          },
          nodes: {
            select: {
              id: true,
              componentType: true,
              componentKey: true,
              kind: true,
              config: true,
              positionX: true,
              positionY: true,
              disabled: true,
            },
          },
          edges: {
            select: {
              id: true,
              sourceNodeId: true,
              targetNodeId: true,
              sourcePort: true,
            },
          },
          versions: {
            orderBy: { version: "desc" as const },
            take: 1,
            select: { version: true, configYaml: true, logLevel: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      const mapped = await Promise.all(pipelines.map(async (p) => {
        let hasUndeployedChanges = false;
        if (!p.isDraft && p.deployedAt) {
          const latestVersion = p.versions[0];
          if (latestVersion?.configYaml) {
            try {
              const decryptedNodes = p.nodes.map((n) => ({
                ...n,
                config: decryptNodeConfig(
                  n.componentType,
                  (n.config as Record<string, unknown>) ?? {},
                ),
              }));
              const flowNodes = decryptedNodes.map((n) => ({
                id: n.id,
                type: n.kind.toLowerCase(),
                position: { x: n.positionX, y: n.positionY },
                data: {
                  componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
                  componentKey: n.componentKey,
                  config: n.config as Record<string, unknown>,
                  disabled: n.disabled,
                },
              }));
              const flowEdges = p.edges.map((e) => ({
                id: e.id,
                source: e.sourceNodeId,
                target: e.targetNodeId,
                ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
              }));
              const currentYaml = generateVectorYaml(
                flowNodes as Parameters<typeof generateVectorYaml>[0],
                flowEdges as Parameters<typeof generateVectorYaml>[1],
                p.globalConfig as Record<string, unknown> | null,
              );
              hasUndeployedChanges = currentYaml !== latestVersion.configYaml;
              if (!hasUndeployedChanges) {
                const currentLogLevel = (p.globalConfig as Record<string, unknown>)?.log_level ?? null;
                const deployedLogLevel = (latestVersion as { logLevel?: string | null }).logLevel ?? null;
                if (currentLogLevel !== deployedLogLevel) {
                  hasUndeployedChanges = true;
                }
              }
            } catch {
              hasUndeployedChanges = false;
            }
          } else if (latestVersion && !latestVersion.configYaml) {
            hasUndeployedChanges = true;
          }
        }

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          isDraft: p.isDraft,
          deployedAt: p.deployedAt,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          tags: (p.tags as string[]) ?? [],
          createdBy: p.createdBy,
          updatedBy: p.updatedBy,
          nodeStatuses: p.nodeStatuses,
          hasUndeployedChanges,
        };
      }));

      return mapped;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.id },
        include: {
          nodes: true,
          edges: true,
          environment: { select: { teamId: true, gitOpsMode: true } },
          nodeStatuses: {
            select: { status: true },
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
      if (!pipeline.isDraft && pipeline.deployedAt) {
        const latestVersion = await prisma.pipelineVersion.findFirst({
          where: { pipelineId: input.id },
          orderBy: { version: "desc" },
          select: { configYaml: true, logLevel: true },
        });

        if (latestVersion) {
          const flowNodes = decryptedNodes.map((n) => ({
            id: n.id,
            type: n.kind.toLowerCase(),
            position: { x: n.positionX, y: n.positionY },
            data: {
              componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
              componentKey: n.componentKey,
              config: n.config as Record<string, unknown>,
              disabled: n.disabled,
            },
          }));
          const flowEdges = pipeline.edges.map((e) => ({
            id: e.id,
            source: e.sourceNodeId,
            target: e.targetNodeId,
            ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
          }));
          const currentYaml = generateVectorYaml(
            flowNodes as Parameters<typeof generateVectorYaml>[0],
            flowEdges as Parameters<typeof generateVectorYaml>[1],
            pipeline.globalConfig as Record<string, unknown> | null,
          );
          hasConfigChanges = currentYaml !== latestVersion.configYaml;

          // Also check if log level changed (stripped from YAML, passed as VECTOR_LOG env var)
          if (!hasConfigChanges) {
            const currentLogLevel = (pipeline.globalConfig as Record<string, unknown>)?.log_level ?? null;
            const deployedLogLevel = latestVersion.logLevel ?? null;
            if (currentLogLevel !== deployedLogLevel) {
              hasConfigChanges = true;
            }
          }
        } else {
          hasConfigChanges = true;
        }
      }

      return {
        ...pipeline,
        nodes: decryptedNodes,
        hasConfigChanges,
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
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.updated", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const { id, tags, ...data } = input;
      const existing = await prisma.pipeline.findUnique({
        where: { id },
        select: { id: true, tags: true, environment: { select: { teamId: true } } },
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

      const updated = await prisma.pipeline.update({
        where: { id },
        data: {
          ...data,
          ...(tags !== undefined ? { tags } : {}),
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
      const source = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: {
          name: true,
          description: true,
          environmentId: true,
          globalConfig: true,
          isSystem: true,
          environment: { select: { teamId: true } },
        },
      });
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      if (source.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "System pipelines cannot be promoted",
        });
      }

      if (source.environmentId === input.targetEnvironmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target environment must be different from source environment",
        });
      }

      const targetEnv = await prisma.environment.findUnique({
        where: { id: input.targetEnvironmentId },
        select: { teamId: true, name: true },
      });
      if (!targetEnv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target environment not found",
        });
      }
      if (targetEnv.teamId !== source.environment.teamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target environment must belong to the same team",
        });
      }

      const pipelineName = input.name ?? source.name;

      const allStrippedSecrets: StrippedRef[] = [];
      const allStrippedCertificates: StrippedRef[] = [];

      // Strip secrets/certs from globalConfig if present
      let strippedGlobalConfig = source.globalConfig ?? undefined;
      if (strippedGlobalConfig && typeof strippedGlobalConfig === "object" && !Array.isArray(strippedGlobalConfig)) {
        const globalResult = stripEnvRefs(strippedGlobalConfig as Record<string, unknown>, "__global__");
        strippedGlobalConfig = globalResult.config as typeof strippedGlobalConfig;
        allStrippedSecrets.push(...globalResult.strippedSecrets);
        allStrippedCertificates.push(...globalResult.strippedCertificates);
      }

      const promoted = await prisma.$transaction(async (tx) => {
        // Check name collision inside transaction to avoid TOCTOU race
        const existing = await tx.pipeline.findFirst({
          where: {
            name: pipelineName,
            environmentId: input.targetEnvironmentId,
          },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A pipeline named "${pipelineName}" already exists in the target environment`,
          });
        }

        const created = await tx.pipeline.create({
          data: {
            name: pipelineName,
            description: source.description,
            environmentId: input.targetEnvironmentId,
            globalConfig: strippedGlobalConfig,
            isDraft: true,
            createdById: ctx.session.user?.id ?? null,
            updatedById: ctx.session.user?.id,
          },
        });

        await copyPipelineGraph(tx, {
          sourcePipelineId: input.pipelineId,
          targetPipelineId: created.id,
          transformConfig: (config, componentKey) => {
            const result = stripEnvRefs(config, componentKey);
            allStrippedSecrets.push(...result.strippedSecrets);
            allStrippedCertificates.push(...result.strippedCertificates);
            return result.config;
          },
        });

        return created;
      });

      return {
        id: promoted.id,
        name: promoted.name,
        targetEnvironmentName: targetEnv.name,
        strippedSecrets: allStrippedSecrets,
        strippedCertificates: allStrippedCertificates,
      };
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
      const existing = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      return prisma.$transaction(async (tx) => {
        await tx.pipeline.update({
          where: { id: input.pipelineId },
          data: {
            updatedById: ctx.session.user?.id,
            ...(input.globalConfig !== undefined
              ? { globalConfig: input.globalConfig ?? undefined }
              : {}),
          },
        });

        await tx.pipelineEdge.deleteMany({
          where: { pipelineId: input.pipelineId },
        });
        await tx.pipelineNode.deleteMany({
          where: { pipelineId: input.pipelineId },
        });

        await Promise.all(
          input.nodes.map((node) =>
            tx.pipelineNode.create({
              data: {
                ...(node.id ? { id: node.id } : {}),
                pipelineId: input.pipelineId,
                componentKey: node.componentKey,
                componentType: node.componentType,
                kind: node.kind,
                config: encryptNodeConfig(node.componentType, node.config) as unknown as typeof node.config,
                positionX: node.positionX,
                positionY: node.positionY,
                disabled: node.disabled,
              },
            })
          )
        );

        await Promise.all(
          input.edges.map((edge) =>
            tx.pipelineEdge.create({
              data: {
                ...(edge.id ? { id: edge.id } : {}),
                pipelineId: input.pipelineId,
                sourceNodeId: edge.sourceNodeId,
                targetNodeId: edge.targetNodeId,
                sourcePort: edge.sourcePort,
              },
            })
          )
        );

        const saved = await tx.pipeline.findUniqueOrThrow({
          where: { id: input.pipelineId },
          include: {
            nodes: true,
            edges: true,
          },
        });
        return {
          ...saved,
          nodes: saved.nodes.map((n) => ({
            ...n,
            config: decryptNodeConfig(
              n.componentType,
              (n.config as Record<string, unknown>) ?? {},
            ),
          })),
        };
      });
    }),

  discardChanges: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.changes_discarded", "Pipeline"))
    .mutation(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { isDraft: true, deployedAt: true },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }
      if (pipeline.isDraft || !pipeline.deployedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot discard changes on a pipeline that has never been deployed",
        });
      }

      const latestVersion = await prisma.pipelineVersion.findFirst({
        where: { pipelineId: input.pipelineId },
        orderBy: { version: "desc" },
      });
      if (!latestVersion) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No deployed version found" });
      }
      if (!latestVersion.nodesSnapshot || !latestVersion.edgesSnapshot) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployed version has no snapshot — deploy once more to enable discard",
        });
      }

      const nodes = latestVersion.nodesSnapshot as Array<Record<string, unknown>>;
      const edges = latestVersion.edgesSnapshot as Array<Record<string, unknown>>;

      await prisma.$transaction(async (tx) => {
        await tx.pipeline.update({
          where: { id: input.pipelineId },
          data: {
            globalConfig: latestVersion.globalConfig as Prisma.InputJsonValue ?? undefined,
          },
        });

        await tx.pipelineEdge.deleteMany({ where: { pipelineId: input.pipelineId } });
        await tx.pipelineNode.deleteMany({ where: { pipelineId: input.pipelineId } });

        await Promise.all(
          nodes.map((node) =>
            tx.pipelineNode.create({
              data: {
                id: node.id as string,
                pipelineId: input.pipelineId,
                componentKey: node.componentKey as string,
                componentType: node.componentType as string,
                kind: node.kind as ComponentKind,
                config: node.config as Prisma.InputJsonValue,
                positionX: node.positionX as number,
                positionY: node.positionY as number,
                disabled: (node.disabled as boolean) ?? false,
              },
            })
          )
        );

        await Promise.all(
          edges.map((edge) =>
            tx.pipelineEdge.create({
              data: {
                id: edge.id as string,
                pipelineId: input.pipelineId,
                sourceNodeId: edge.sourceNodeId as string,
                targetNodeId: edge.targetNodeId as string,
                sourcePort: (edge.sourcePort as string) ?? null,
              },
            })
          )
        );
      });

      return { discarded: true };
    }),

  versions: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listVersions(input.pipelineId);
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
        componentType: n.componentType,
        kind: n.kind,
        config: n.config,
        positionX: n.positionX,
        positionY: n.positionY,
        disabled: n.disabled,
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
      return rollback(input.pipelineId, input.targetVersionId, userId);
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
});
