import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { LogLevel } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import { checkDevAgentVersion } from "@/server/services/version-check";

export const fleetRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.vectorNode.findMany({
        where: { environmentId: input.environmentId },
        include: {
          environment: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const node = await prisma.vectorNode.findUnique({
        where: { id: input.id },
        include: {
          environment: { select: { id: true, name: true } },
          pipelineStatuses: {
            include: {
              pipeline: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!node) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node not found",
        });
      }
      return node;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        host: z.string().min(1),
        apiPort: z.number().int().min(1).max(65535).default(8686),
        environmentId: z.string(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("fleet.node.created", "VectorNode"))
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

      return prisma.vectorNode.create({
        data: {
          name: input.name,
          host: input.host,
          apiPort: input.apiPort,
          environmentId: input.environmentId,
        },
        include: {
          environment: { select: { id: true, name: true } },
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("fleet.node.updated", "VectorNode"))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const existing = await prisma.vectorNode.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node not found",
        });
      }
      return prisma.vectorNode.update({
        where: { id },
        data,
        include: {
          environment: { select: { id: true, name: true } },
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("fleet.node.deleted", "VectorNode"))
    .mutation(async ({ input }) => {
      const existing = await prisma.vectorNode.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node not found",
        });
      }
      return prisma.vectorNode.delete({
        where: { id: input.id },
      });
    }),

  nodeLogs: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
        levels: z.array(z.nativeEnum(LogLevel)).optional(),
        pipelineId: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { nodeId, cursor, limit, levels, pipelineId } = input;
      const take = limit;

      const where: Record<string, unknown> = { nodeId };
      if (levels && levels.length > 0) {
        where.level = { in: levels };
      }
      if (pipelineId) {
        where.pipelineId = pipelineId;
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

  nodeMetrics: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        hours: z.number().min(1).max(168).default(1),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

      return prisma.nodeMetric.findMany({
        where: {
          nodeId: input.nodeId,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "asc" },
        select: {
          timestamp: true,
          memoryTotalBytes: true,
          memoryUsedBytes: true,
          memoryFreeBytes: true,
          cpuSecondsTotal: true,
          cpuSecondsIdle: true,
          loadAvg1: true,
          loadAvg5: true,
          loadAvg15: true,
          fsTotalBytes: true,
          fsUsedBytes: true,
          fsFreeBytes: true,
          diskReadBytes: true,
          diskWrittenBytes: true,
          netRxBytes: true,
          netTxBytes: true,
        },
      });
    }),

  revokeNode: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("fleet.node.revoked", "VectorNode"))
    .mutation(async ({ input }) => {
      const node = await prisma.vectorNode.findUnique({
        where: { id: input.id },
      });
      if (!node) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
      }
      return prisma.vectorNode.update({
        where: { id: input.id },
        data: {
          nodeTokenHash: null,
          status: "UNREACHABLE",
        },
      });
    }),

  triggerAgentUpdate: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        targetVersion: z.string(),
        downloadUrl: z.string().url(),
        checksum: z.string(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("node.update_triggered", "VectorNode"))
    .mutation(async ({ input }) => {
      const node = await prisma.vectorNode.findUnique({
        where: { id: input.nodeId },
      });
      if (!node) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
      }
      if (node.deploymentMode === "DOCKER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot auto-update Docker agents",
        });
      }

      let { targetVersion, downloadUrl, checksum } = input;

      // Dev releases are rolling — the binary at the download URL may have been
      // replaced since the UI cached the version/checksum. Force-refresh to get
      // the current release data and avoid checksum mismatch on the agent.
      if (targetVersion.startsWith("dev-")) {
        const fresh = await checkDevAgentVersion(true);
        if (fresh.latestVersion && fresh.latestVersion !== targetVersion) {
          const binaryName = downloadUrl.split("/").pop() ?? "vf-agent-linux-amd64";
          const freshChecksum = fresh.checksums[binaryName];
          if (freshChecksum) {
            targetVersion = fresh.latestVersion;
            checksum = `sha256:${freshChecksum}`;
          }
        }
      }

      return prisma.vectorNode.update({
        where: { id: input.nodeId },
        data: {
          pendingAction: {
            type: "self_update",
            targetVersion,
            downloadUrl,
            checksum,
          },
        },
      });
    }),

  updateLabels: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        labels: z.record(z.string(), z.string()),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("vectorNode.updated", "VectorNode"))
    .mutation(async ({ input }) => {
      return prisma.vectorNode.update({
        where: { id: input.nodeId },
        data: { labels: input.labels },
      });
    }),

  listLabels: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const nodes = await prisma.vectorNode.findMany({
        where: { environmentId: input.environmentId },
        select: { labels: true },
      });
      const labelMap: Record<string, Set<string>> = {};
      for (const node of nodes) {
        const labels = (node.labels as Record<string, string>) ?? {};
        for (const [key, value] of Object.entries(labels)) {
          if (!labelMap[key]) labelMap[key] = new Set();
          labelMap[key].add(value);
        }
      }
      return Object.fromEntries(
        Object.entries(labelMap).map(([k, v]) => [k, [...v].sort()]),
      );
    }),

  setMaintenanceMode: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        enabled: z.boolean(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("node.maintenance_toggled", "VectorNode"))
    .mutation(async ({ input }) => {
      const node = await prisma.vectorNode.findUnique({
        where: { id: input.nodeId },
      });
      if (!node) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
      }
      return prisma.vectorNode.update({
        where: { id: input.nodeId },
        data: {
          maintenanceMode: input.enabled,
          maintenanceModeAt: input.enabled ? new Date() : null,
        },
      });
    }),

  listWithPipelineStatus: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const nodes = await prisma.vectorNode.findMany({
        where: { environmentId: input.environmentId },
        include: {
          pipelineStatuses: {
            include: {
              pipeline: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const deployedPipelines = await prisma.pipeline.findMany({
        where: {
          environmentId: input.environmentId,
          isDraft: false,
          deployedAt: { not: null },
        },
        select: {
          id: true,
          name: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { version: true },
          },
        },
      });

      return {
        nodes,
        deployedPipelines: deployedPipelines.map((p) => ({
          id: p.id,
          name: p.name,
          latestVersion: p.versions[0]?.version ?? 1,
        })),
      };
    }),
});
