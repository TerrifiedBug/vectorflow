import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, ComponentKind } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { encryptNodeConfig, decryptNodeConfig } from "@/server/services/config-crypto";

export const sharedComponentRouter = router({
  /** List all shared components for an environment */
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const components = await prisma.sharedComponent.findMany({
        where: { environmentId: input.environmentId },
        include: {
          linkedNodes: { select: { pipelineId: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      return components.map((sc) => ({
        id: sc.id,
        name: sc.name,
        description: sc.description,
        componentType: sc.componentType,
        kind: sc.kind,
        config: decryptNodeConfig(
          sc.componentType,
          (sc.config as Record<string, unknown>) ?? {},
        ),
        version: sc.version,
        linkedPipelineCount: new Set(sc.linkedNodes.map((n) => n.pipelineId)).size,
        createdAt: sc.createdAt,
        updatedAt: sc.updatedAt,
      }));
    }),

  /** Get a single shared component by ID with linked pipeline details */
  getById: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const sc = await prisma.sharedComponent.findUnique({
        where: { id: input.id },
        include: {
          linkedNodes: {
            include: {
              pipeline: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!sc || sc.environmentId !== input.environmentId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shared component not found",
        });
      }

      // Group linked nodes by pipeline and determine staleness per pipeline
      const pipelineMap = new Map<
        string,
        { id: string; name: string; isStale: boolean }
      >();
      for (const node of sc.linkedNodes) {
        const pid = node.pipelineId;
        const existing = pipelineMap.get(pid);
        const isStale = node.sharedComponentVersion !== sc.version;
        if (!existing) {
          pipelineMap.set(pid, {
            id: node.pipeline.id,
            name: node.pipeline.name,
            isStale,
          });
        } else if (isStale) {
          // If any node in this pipeline is stale, mark pipeline as stale
          existing.isStale = true;
        }
      }

      return {
        id: sc.id,
        name: sc.name,
        description: sc.description,
        componentType: sc.componentType,
        kind: sc.kind,
        config: decryptNodeConfig(
          sc.componentType,
          (sc.config as Record<string, unknown>) ?? {},
        ),
        version: sc.version,
        environmentId: sc.environmentId,
        createdAt: sc.createdAt,
        updatedAt: sc.updatedAt,
        linkedPipelines: Array.from(pipelineMap.values()),
      };
    }),

  /** Create a new shared component */
  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        componentType: z.string().min(1),
        kind: z.nativeEnum(ComponentKind),
        config: z.record(z.string(), z.any()),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.created", "SharedComponent"))
    .mutation(async ({ input }) => {
      // Check unique constraint (environmentId + name)
      const existing = await prisma.sharedComponent.findUnique({
        where: {
          environmentId_name: {
            environmentId: input.environmentId,
            name: input.name,
          },
        },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A shared component named "${input.name}" already exists in this environment`,
        });
      }

      return prisma.sharedComponent.create({
        data: {
          environmentId: input.environmentId,
          name: input.name,
          description: input.description,
          componentType: input.componentType,
          kind: input.kind,
          config: encryptNodeConfig(input.componentType, input.config) as Prisma.InputJsonValue,
        },
      });
    }),

  /** Create a shared component from an existing pipeline node */
  createFromNode: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        pipelineId: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        environmentId: z.string(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.created", "SharedComponent"))
    .mutation(async ({ input }) => {
      const node = await prisma.pipelineNode.findUnique({
        where: { id: input.nodeId },
      });
      if (!node || node.pipelineId !== input.pipelineId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline node not found",
        });
      }

      return prisma.$transaction(async (tx) => {
        // Check unique constraint inside transaction to prevent TOCTOU race
        const existing = await tx.sharedComponent.findUnique({
          where: {
            environmentId_name: {
              environmentId: input.environmentId,
              name: input.name,
            },
          },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A shared component named "${input.name}" already exists in this environment`,
          });
        }

        const sharedComponent = await tx.sharedComponent.create({
          data: {
            environmentId: input.environmentId,
            name: input.name,
            description: input.description,
            componentType: node.componentType,
            kind: node.kind,
            config: (node.config ?? {}) as Prisma.InputJsonValue,
          },
        });

        // Link the original node to the shared component
        await tx.pipelineNode.update({
          where: { id: input.nodeId },
          data: {
            sharedComponentId: sharedComponent.id,
            sharedComponentVersion: sharedComponent.version,
          },
        });

        return sharedComponent;
      });
    }),

  /** Update a shared component */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().nullable().optional(),
        config: z.record(z.string(), z.any()).optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.updated", "SharedComponent"))
    .mutation(async ({ input }) => {
      const sc = await prisma.sharedComponent.findUnique({
        where: { id: input.id },
      });
      if (!sc || sc.environmentId !== input.environmentId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shared component not found",
        });
      }

      // If name changes, check for conflicts
      if (input.name && input.name !== sc.name) {
        const conflict = await prisma.sharedComponent.findUnique({
          where: {
            environmentId_name: {
              environmentId: sc.environmentId,
              name: input.name,
            },
          },
        });
        if (conflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A shared component named "${input.name}" already exists in this environment`,
          });
        }
      }

      const data: Prisma.SharedComponentUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;

      // If config changes, encrypt and bump version atomically
      if (input.config) {
        data.config = encryptNodeConfig(sc.componentType, input.config) as Prisma.InputJsonValue;
        data.version = { increment: 1 };
      }

      return prisma.sharedComponent.update({
        where: { id: input.id },
        data,
      });
    }),

  /** Delete a shared component */
  delete: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.deleted", "SharedComponent"))
    .mutation(async ({ input }) => {
      const sc = await prisma.sharedComponent.findUnique({
        where: { id: input.id },
      });
      if (!sc || sc.environmentId !== input.environmentId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shared component not found",
        });
      }

      // onDelete: SetNull handles unlinking automatically
      return prisma.sharedComponent.delete({
        where: { id: input.id },
      });
    }),

  /** Accept latest shared component config into a pipeline node */
  acceptUpdate: protectedProcedure
    .input(z.object({ nodeId: z.string(), pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.update_accepted", "SharedComponent"))
    .mutation(async ({ input }) => {
      const node = await prisma.pipelineNode.findUnique({
        where: { id: input.nodeId },
        include: { sharedComponent: true },
      });
      if (!node || node.pipelineId !== input.pipelineId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline node not found",
        });
      }
      if (!node.sharedComponent) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Node is not linked to a shared component",
        });
      }

      // Copy latest config from shared component into the node
      return prisma.pipelineNode.update({
        where: { id: input.nodeId },
        data: {
          config: node.sharedComponent.config ?? undefined,
          sharedComponentVersion: node.sharedComponent.version,
        },
      });
    }),

  /** Accept updates for all stale linked nodes in a pipeline */
  acceptUpdateBulk: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.bulk_update_accepted", "Pipeline"))
    .mutation(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
      });
      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      // Find all nodes in this pipeline that are linked to a shared component
      const linkedNodes = await prisma.pipelineNode.findMany({
        where: {
          pipelineId: input.pipelineId,
          sharedComponentId: { not: null },
        },
        include: { sharedComponent: true },
      });

      // Filter to only stale nodes
      const staleNodes = linkedNodes.filter(
        (n) =>
          n.sharedComponent &&
          n.sharedComponentVersion !== n.sharedComponent.version,
      );

      if (staleNodes.length === 0) {
        return { updated: 0 };
      }

      await prisma.$transaction(
        staleNodes.map((n) =>
          prisma.pipelineNode.update({
            where: { id: n.id },
            data: {
              config: n.sharedComponent!.config ?? undefined,
              sharedComponentVersion: n.sharedComponent!.version,
            },
          }),
        ),
      );

      return { updated: staleNodes.length };
    }),

  /** Unlink a pipeline node from its shared component */
  unlink: protectedProcedure
    .input(z.object({ nodeId: z.string(), pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.unlinked", "SharedComponent"))
    .mutation(async ({ input }) => {
      const node = await prisma.pipelineNode.findUnique({
        where: { id: input.nodeId },
      });
      if (!node || node.pipelineId !== input.pipelineId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline node not found",
        });
      }

      return prisma.pipelineNode.update({
        where: { id: input.nodeId },
        data: {
          sharedComponentId: null,
          sharedComponentVersion: null,
        },
      });
    }),

  /** Link an existing pipeline node to a shared component */
  linkExisting: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        pipelineId: z.string(),
        sharedComponentId: z.string(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("shared_component.linked", "SharedComponent"))
    .mutation(async ({ input }) => {
      const node = await prisma.pipelineNode.findUnique({
        where: { id: input.nodeId },
        include: { pipeline: { select: { environmentId: true } } },
      });
      if (!node || node.pipelineId !== input.pipelineId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline node not found",
        });
      }

      const sc = await prisma.sharedComponent.findUnique({
        where: { id: input.sharedComponentId },
      });
      if (!sc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shared component not found",
        });
      }

      // Validate shared component belongs to the same environment as the pipeline
      if (sc.environmentId !== node.pipeline.environmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Shared component belongs to a different environment",
        });
      }

      // Validate type/kind match
      if (node.componentType !== sc.componentType || node.kind !== sc.kind) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Component type/kind mismatch: node is ${node.kind}/${node.componentType} but shared component is ${sc.kind}/${sc.componentType}`,
        });
      }

      // Copy config from shared component and set link fields
      return prisma.pipelineNode.update({
        where: { id: input.nodeId },
        data: {
          config: sc.config ?? undefined,
          sharedComponentId: sc.id,
          sharedComponentVersion: sc.version,
        },
      });
    }),
});
