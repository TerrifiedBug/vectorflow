import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { LogLevel } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import { checkDevAgentVersion } from "@/server/services/version-check";
import { pushRegistry } from "@/server/services/push-registry";
import { relayPush } from "@/server/services/push-broadcast";
import { getFleetOverview, getVolumeTrend, getNodeThroughput, getNodeCapacity, getDataLoss, getMatrixThroughput } from "@/server/services/fleet-data";

export const fleetRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        search: z.string().optional(),
        status: z.array(z.string()).optional(),
        labels: z.record(z.string(), z.string()).optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { environmentId: input.environmentId };

      // Search by name or host
      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { host: { contains: input.search, mode: "insensitive" } },
        ];
      }

      // Status filter
      if (input.status && input.status.length > 0) {
        where.status = { in: input.status };
      }

      const nodes = await prisma.vectorNode.findMany({
        where,
        include: {
          environment: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // Label filtering (post-query since labels are JSON)
      let filtered = nodes;
      if (input.labels && Object.keys(input.labels).length > 0) {
        filtered = nodes.filter((node) => {
          const nodeLabels = (node.labels as Record<string, string>) ?? {};
          return Object.entries(input.labels!).every(
            ([key, value]) => nodeLabels[key] === value,
          );
        });
      }

      // Label compliance check (NODE-02)
      const nodeGroups = await prisma.nodeGroup.findMany({
        where: { environmentId: input.environmentId },
        select: { requiredLabels: true },
      });
      const allRequiredLabels = [
        ...new Set(nodeGroups.flatMap((g) => g.requiredLabels as string[])),
      ];

      return filtered.map((node) => ({
        ...node,
        pushConnected: pushRegistry.isConnected(node.id),
        labelCompliant: allRequiredLabels.length === 0 ||
          allRequiredLabels.every((key) =>
            Object.prototype.hasOwnProperty.call(
              (node.labels as Record<string, string>) ?? {},
              key,
            ),
          ),
      }));
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
      const latestEvent = await prisma.nodeStatusEvent.findFirst({
        where: { nodeId: input.id, toStatus: node.status },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      });
      return {
        ...node,
        currentStatusSince: latestEvent?.timestamp ?? null,
      };
    }),

  getStatusTimeline: protectedProcedure
    .input(z.object({
      nodeId: z.string(),
      range: z.enum(["1h", "6h", "1d", "7d", "30d"]),
    }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const rangeMs: Record<string, number> = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "1d": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };
      const since = new Date(Date.now() - rangeMs[input.range]);
      const [events, node] = await Promise.all([
        prisma.nodeStatusEvent.findMany({
          where: { nodeId: input.nodeId, timestamp: { gte: since } },
          orderBy: { timestamp: "asc" },
        }),
        prisma.vectorNode.findUnique({
          where: { id: input.nodeId },
          select: { status: true },
        }),
      ]);
      return { events, nodeStatus: node?.status ?? "UNKNOWN" };
    }),

  getUptime: protectedProcedure
    .input(z.object({
      nodeId: z.string(),
      range: z.enum(["1d", "7d", "30d"]),
    }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const rangeMs: Record<string, number> = {
        "1d": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };
      const now = Date.now();
      const since = new Date(now - rangeMs[input.range]);
      const totalSeconds = rangeMs[input.range] / 1000;

      // Get events in range
      const events = await prisma.nodeStatusEvent.findMany({
        where: { nodeId: input.nodeId, timestamp: { gte: since } },
        orderBy: { timestamp: "asc" },
      });

      // Get the last event before the range to know starting status,
      // and the node's current status as a fallback for nodes with no event history
      const [priorEvent, nodeForStatus] = await Promise.all([
        prisma.nodeStatusEvent.findFirst({
          where: { nodeId: input.nodeId, timestamp: { lt: since } },
          orderBy: { timestamp: "desc" },
        }),
        prisma.vectorNode.findUnique({
          where: { id: input.nodeId },
          select: { status: true },
        }),
      ]);

      // Walk events, tracking time in HEALTHY status
      let healthySeconds = 0;
      let incidents = 0;
      let currentStatus = priorEvent?.toStatus ?? nodeForStatus?.status ?? "UNKNOWN";
      let cursor = since.getTime();

      for (const event of events) {
        const eventTime = event.timestamp.getTime();
        const elapsed = (eventTime - cursor) / 1000;
        if (currentStatus === "HEALTHY") {
          healthySeconds += elapsed;
        }
        if (event.toStatus === "UNREACHABLE" || event.toStatus === "DEGRADED") {
          incidents++;
        }
        currentStatus = event.toStatus;
        cursor = eventTime;
      }

      // Account for time from last event to now
      const remaining = (now - cursor) / 1000;
      if (currentStatus === "HEALTHY") {
        healthySeconds += remaining;
      }

      const uptimePercent = totalSeconds > 0
        ? Math.round((healthySeconds / totalSeconds) * 10000) / 100
        : 0;

      return { uptimePercent, totalSeconds, healthySeconds: Math.round(healthySeconds), incidents };
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
      if (node.status === "UNREACHABLE") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Cannot update an unreachable agent — wait for it to reconnect before retrying",
        });
      }

      const { downloadUrl } = input;
      let { targetVersion, checksum } = input;

      // Dev releases are rolling — the binary at the download URL may have been
      // replaced since the UI cached the version/checksum. Force-refresh to get
      // the current release data and avoid checksum mismatch on the agent.
      if (targetVersion.startsWith("dev-")) {
        const fresh = await checkDevAgentVersion(true);
        if (!fresh.latestVersion) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to fetch current dev release info — retry the update",
          });
        }
        const binaryName = downloadUrl.split("/").pop() ?? "vf-agent-linux-amd64";
        const freshChecksum = fresh.checksums[binaryName];
        if (!freshChecksum) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to retrieve fresh checksum for ${binaryName} — retry the update`,
          });
        }
        targetVersion = fresh.latestVersion;
        checksum = `sha256:${freshChecksum}`;
      }

      const updated = await prisma.vectorNode.update({
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

      // Push action to agent via SSE (fallback: agent reads pendingAction on next poll)
      relayPush(input.nodeId, {
        type: "action",
        action: "self_update",
        targetVersion,
        downloadUrl,
        checksum,
      });

      return updated;
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
      const updated = await prisma.vectorNode.update({
        where: { id: input.nodeId },
        data: {
          maintenanceMode: input.enabled,
          maintenanceModeAt: input.enabled ? new Date() : null,
        },
      });

      // Maintenance mode changes what the config endpoint returns — notify agent to re-poll
      relayPush(input.nodeId, {
        type: "config_changed",
        reason: input.enabled ? "maintenance_on" : "maintenance_off",
      });

      return updated;
    }),

  listWithPipelineStatus: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      // Two queries in parallel (both needed, but no N+1 within each)
      const [nodes, deployedPipelines] = await Promise.all([
        prisma.vectorNode.findMany({
          where: { environmentId: input.environmentId },
          include: {
            pipelineStatuses: {
              include: {
                pipeline: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.pipeline.findMany({
          where: {
            environmentId: input.environmentId,
            isDraft: false,
            deployedAt: { not: null },
          },
          select: {
            id: true,
            name: true,
            tags: true,
            versions: {
              orderBy: { version: "desc" as const },
              take: 1,
              select: { version: true },
            },
          },
        }),
      ]);

      return {
        nodes: nodes.map((node) => ({
          ...node,
          pushConnected: pushRegistry.isConnected(node.id),
        })),
        deployedPipelines: deployedPipelines.map((p) => ({
          id: p.id,
          name: p.name,
          latestVersion: p.versions[0]?.version ?? 1,
          tags: (p.tags as string[]) ?? [],
        })),
      };
    }),

  overview: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: z.enum(["1h", "6h", "1d", "7d", "30d"]).default("1d"),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getFleetOverview(input.environmentId, input.range);
    }),

  volumeTrend: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: z.enum(["1h", "6h", "1d", "7d", "30d"]).default("1d"),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getVolumeTrend(input.environmentId, input.range);
    }),

  nodeThroughput: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: z.enum(["1h", "6h", "1d", "7d", "30d"]).default("1d"),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getNodeThroughput(input.environmentId, input.range);
    }),

  nodeCapacity: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: z.enum(["1h", "6h", "1d", "7d", "30d"]).default("1d"),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getNodeCapacity(input.environmentId, input.range);
    }),

  dataLoss: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: z.enum(["1h", "6h", "1d", "7d", "30d"]).default("1d"),
        threshold: z.number().min(0).max(1).default(0.05),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getDataLoss(input.environmentId, input.range, input.threshold);
    }),

  matrixThroughput: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: z.enum(["1h", "6h", "1d", "7d", "30d"]).default("1d"),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getMatrixThroughput(input.environmentId, input.range);
    }),

  matrixSummary: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      // Single query: fetch nodes with pipeline statuses AND latest version per pipeline
      const nodes = await prisma.vectorNode.findMany({
        where: { environmentId: input.environmentId },
        include: {
          pipelineStatuses: {
            include: {
              pipeline: {
                select: {
                  id: true,
                  name: true,
                  versions: {
                    orderBy: { version: "desc" as const },
                    take: 1,
                    select: { version: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      });

      return nodes.map((node) => {
        const pipelineCount = node.pipelineStatuses.length;

        const errorCount = node.pipelineStatuses.filter(
          (ps) => ps.status === "CRASHED" || ps.status === "STOPPED"
        ).length;

        const versionDriftCount = node.pipelineStatuses.filter((ps) => {
          const latestVersion = ps.pipeline.versions[0]?.version;
          return latestVersion != null && ps.version < latestVersion;
        }).length;

        return {
          nodeId: node.id,
          nodeName: node.name,
          host: node.host,
          status: node.status,
          maintenanceMode: node.maintenanceMode,
          pipelineCount,
          errorCount,
          versionDriftCount,
        };
      });
    }),
});
