import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { ComponentKind } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import {
  createVersion,
  listVersions,
  getVersion,
  rollback,
} from "@/server/services/pipeline-version";
import { encryptNodeConfig, decryptNodeConfig } from "@/server/services/config-crypto";

const nodeSchema = z.object({
  id: z.string().optional(),
  componentKey: z.string().min(1),
  componentType: z.string().min(1),
  kind: z.nativeEnum(ComponentKind),
  config: z.record(z.string(), z.any()),
  positionX: z.number(),
  positionY: z.number(),
});

const edgeSchema = z.object({
  id: z.string().optional(),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sourcePort: z.string().optional(),
});

export const pipelineRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .query(async ({ input }) => {
      return prisma.pipeline.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          name: true,
          description: true,
          isDraft: true,
          deployedAt: true,
          updatedAt: true,
          updatedBy: { select: { name: true, email: true } },
          _count: { select: { nodes: true, edges: true } },
        },
        orderBy: { updatedAt: "desc" },
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.id },
        include: {
          nodes: true,
          edges: true,
        },
      });
      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      return {
        ...pipeline,
        nodes: pipeline.nodes.map((n) => ({
          ...n,
          config: decryptNodeConfig(
            n.componentType,
            (n.config as Record<string, unknown>) ?? {},
          ),
        })),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        environmentId: z.string(),
      })
    )
    .use(withAudit("pipeline.created", "Pipeline"))
    .mutation(async ({ input }) => {
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
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().nullable().optional(),
      })
    )
    .use(withAudit("pipeline.updated", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const existing = await prisma.pipeline.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      return prisma.pipeline.update({
        where: { id },
        data: {
          ...data,
          updatedById: ctx.session.user?.id,
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withAudit("pipeline.deleted", "Pipeline"))
    .mutation(async ({ input }) => {
      const existing = await prisma.pipeline.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      return prisma.pipeline.delete({
        where: { id: input.id },
      });
    }),

  saveGraph: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        nodes: z.array(nodeSchema),
        edges: z.array(edgeSchema),
      })
    )
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
          data: { updatedById: ctx.session.user?.id },
        });

        await tx.pipelineEdge.deleteMany({
          where: { pipelineId: input.pipelineId },
        });
        await tx.pipelineNode.deleteMany({
          where: { pipelineId: input.pipelineId },
        });

        const createdNodes = await Promise.all(
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
              },
            })
          )
        );

        const createdEdges = await Promise.all(
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

  versions: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
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
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return createVersion(
        input.pipelineId,
        input.configYaml,
        userId,
        input.changelog,
      );
    }),

  getVersion: protectedProcedure
    .input(z.object({ versionId: z.string() }))
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
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return rollback(input.pipelineId, input.targetVersionId, userId);
    }),
});
