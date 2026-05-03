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
import { isVersionOlder } from "@/lib/version";

const maintenanceWindowSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});

const agentUpgradeSelectorSchema = z
  .object({
    nodeIds: z.array(z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    nodeGroupId: z.string().optional(),
  })
  .optional();

const agentUpgradeBaseInput = z.object({
  environmentId: z.string(),
  targetVersion: z.string().min(1),
  selector: agentUpgradeSelectorSchema,
  canaryNodeIds: z.array(z.string()).optional(),
  waveSize: z.number().int().min(1).max(100).default(10),
  maintenanceWindow: maintenanceWindowSchema.optional(),
});

type MaintenanceWindow = z.infer<typeof maintenanceWindowSchema>;
type AgentUpgradeSelector = z.infer<typeof agentUpgradeSelectorSchema>;
type AgentUpgradeBaseInput = z.infer<typeof agentUpgradeBaseInput>;

type UpgradeNode = {
  id: string;
  name: string;
  status: string;
  labels: unknown;
  agentVersion: string | null;
  deploymentMode: string;
  pendingAction: unknown;
};

type SkipReason = "docker" | "unreachable" | "pending_action" | "already_current";

function getMaintenanceWindowStatus(window?: MaintenanceWindow) {
  if (!window) return null;

  const now = Date.now();
  const start = new Date(window.startAt).getTime();
  const end = new Date(window.endAt).getTime();

  if (end <= start) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Maintenance window end must be after start",
    });
  }

  if (now < start) return "scheduled" as const;
  if (now > end) return "expired" as const;
  return "open" as const;
}

function getUpdateSkipReason(node: UpgradeNode, targetVersion: string): SkipReason | null {
  if (node.deploymentMode === "DOCKER") return "docker";
  if (node.status === "UNREACHABLE") return "unreachable";
  if (node.pendingAction) return "pending_action";
  if (node.agentVersion === targetVersion) return "already_current";
  return null;
}

function labelsMatch(nodeLabels: unknown, required: Record<string, string>) {
  const labels = (nodeLabels as Record<string, string>) ?? {};
  return Object.entries(required).every(([key, value]) => labels[key] === value);
}

function chunkNodes<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function getSelectorLabels(
  environmentId: string,
  selector: AgentUpgradeSelector,
) {
  const labels = { ...(selector?.labels ?? {}) };
  if (!selector?.nodeGroupId) return labels;

  const group = await prisma.nodeGroup.findUnique({
    where: { id: selector.nodeGroupId },
    select: { environmentId: true, criteria: true },
  });
  if (!group || group.environmentId !== environmentId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Node group not found" });
  }

  const criteria = (group.criteria as Record<string, unknown>) ?? {};
  for (const [key, value] of Object.entries(criteria)) {
    if (typeof value === "string") {
      labels[key] = value;
    }
  }
  return labels;
}

async function buildAgentUpgradePlan(input: AgentUpgradeBaseInput) {
  const selectorLabels = await getSelectorLabels(input.environmentId, input.selector);
  const nodes = await prisma.vectorNode.findMany({
    where: {
      environmentId: input.environmentId,
      ...(input.selector?.nodeIds ? { id: { in: input.selector.nodeIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      labels: true,
      agentVersion: true,
      deploymentMode: true,
      pendingAction: true,
    },
    orderBy: { name: "asc" },
  }) as UpgradeNode[];

  const matched = nodes.filter((node) => labelsMatch(node.labels, selectorLabels));
  const blocked = {
    docker: 0,
    unreachable: 0,
    alreadyCurrent: 0,
    pendingAction: 0,
  };
  const eligible: UpgradeNode[] = [];
  const degraded: string[] = [];

  for (const node of matched) {
    const skipReason = getUpdateSkipReason(node, input.targetVersion);
    if (skipReason === "docker") {
      blocked.docker++;
      continue;
    }
    if (skipReason === "unreachable") {
      blocked.unreachable++;
      continue;
    }
    if (skipReason === "pending_action") {
      blocked.pendingAction++;
      continue;
    }
    if (skipReason === "already_current") {
      blocked.alreadyCurrent++;
      continue;
    }
    if (node.status === "DEGRADED") {
      degraded.push(node.id);
    }
    eligible.push(node);
  }

  const eligibleById = new Map(eligible.map((node) => [node.id, node]));
  const canaryNodeIds = input.canaryNodeIds?.filter((id) => eligibleById.has(id)) ?? [];
  const canarySet = new Set(canaryNodeIds);
  const remaining = eligible.filter((node) => !canarySet.has(node.id));
  const waves = [
    ...(canaryNodeIds.length > 0
      ? [{
          index: 0,
          stage: "canary" as const,
          nodeIds: canaryNodeIds,
          nodes: canaryNodeIds.map((id) => eligibleById.get(id)!).map((node) => ({
            id: node.id,
            name: node.name,
            status: node.status,
            agentVersion: node.agentVersion,
          })),
        }]
      : []),
    ...chunkNodes(remaining, input.waveSize).map((wave, index) => ({
      index: canaryNodeIds.length > 0 ? index + 1 : index,
      stage: "wave" as const,
      nodeIds: wave.map((node) => node.id),
      nodes: wave.map((node) => ({
        id: node.id,
        name: node.name,
        status: node.status,
        agentVersion: node.agentVersion,
      })),
    })),
  ];

  const risk = blocked.unreachable > 0 || degraded.length > 2
    ? "high"
    : degraded.length > 0 || eligible.length > 10 || waves.length > 1
      ? "medium"
      : "low";
  const windowStatus = getMaintenanceWindowStatus(input.maintenanceWindow);

  return {
    summary: {
      totalMatched: matched.length,
      eligible: eligible.length,
      blockedDocker: blocked.docker,
      blockedUnreachable: blocked.unreachable,
      blockedAlreadyCurrent: blocked.alreadyCurrent,
      blockedPendingAction: blocked.pendingAction,
      degradedEligibleNodeIds: degraded,
      risk,
    },
    maintenanceWindow: input.maintenanceWindow
      ? { ...input.maintenanceWindow, status: windowStatus }
      : null,
    waves,
  };
}

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

  previewAgentUpgrade: protectedProcedure
    .input(agentUpgradeBaseInput)
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return buildAgentUpgradePlan(input);
    }),

  agentDriftReport: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        targetVersion: z.string().min(1),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const nodes = await prisma.vectorNode.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          name: true,
          status: true,
          labels: true,
          agentVersion: true,
          deploymentMode: true,
          pendingAction: true,
        },
        orderBy: { name: "asc" },
      }) as UpgradeNode[];

      const summary = {
        total: nodes.length,
        behind: 0,
        current: 0,
        unknown: 0,
        docker: 0,
      };

      const reportNodes = nodes.map((node) => {
        let drift: "behind" | "current" | "unknown";
        if (!node.agentVersion) {
          drift = "unknown";
          summary.unknown++;
        } else if (isVersionOlder(node.agentVersion, input.targetVersion)) {
          drift = "behind";
          summary.behind++;
        } else {
          drift = "current";
          summary.current++;
        }

        if (node.deploymentMode === "DOCKER") {
          summary.docker++;
        }

        return {
          id: node.id,
          name: node.name,
          status: node.status,
          deploymentMode: node.deploymentMode,
          agentVersion: node.agentVersion,
          targetVersion: input.targetVersion,
          drift,
          pendingAction: Boolean(node.pendingAction),
          autoUpdateEligible:
            drift === "behind" &&
            getUpdateSkipReason(node, input.targetVersion) === null,
        };
      });

      return {
        targetVersion: input.targetVersion,
        summary,
        nodes: reportNodes,
      };
    }),

  triggerAgentUpdates: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        nodeIds: z.array(z.string()).min(1).max(500),
        targetVersion: z.string().min(1),
        downloadUrl: z.string().url(),
        checksum: z.string(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("fleet.agent_updates_triggered", "VectorNode"))
    .mutation(async ({ input }) => {
      const nodes = await prisma.vectorNode.findMany({
        where: { id: { in: input.nodeIds }, environmentId: input.environmentId },
        select: {
          id: true,
          name: true,
          status: true,
          labels: true,
          agentVersion: true,
          deploymentMode: true,
          pendingAction: true,
        },
        orderBy: { name: "asc" },
      }) as UpgradeNode[];

      const foundIds = new Set(nodes.map((node) => node.id));
      const skipped: Array<{ nodeId: string; reason: SkipReason | "not_found" }> = input.nodeIds
        .filter((id) => !foundIds.has(id))
        .map((id) => ({ nodeId: id, reason: "not_found" as const }));
      const eligible: UpgradeNode[] = [];

      for (const node of nodes) {
        const reason = getUpdateSkipReason(node, input.targetVersion);
        if (reason) {
          skipped.push({ nodeId: node.id, reason });
          continue;
        }
        eligible.push(node);
      }

      const triggeredNodeIds = eligible.map((node) => node.id);
      if (triggeredNodeIds.length === 0) {
        return {
          updatedCount: 0,
          triggeredNodeIds,
          skipped,
        };
      }

      const { downloadUrl } = input;
      let { targetVersion, checksum } = input;

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

      const pendingAction = {
        type: "self_update",
        targetVersion,
        downloadUrl,
        checksum,
      };

      const updated = await prisma.vectorNode.updateMany({
        where: { id: { in: triggeredNodeIds } },
        data: { pendingAction },
      });

      for (const nodeId of triggeredNodeIds) {
        relayPush(nodeId, {
          type: "action",
          action: "self_update",
          targetVersion,
          downloadUrl,
          checksum,
        });
      }

      return {
        updatedCount: updated.count,
        triggeredNodeIds,
        skipped,
      };
    }),

  triggerBulkAgentUpdate: protectedProcedure
    .input(
      agentUpgradeBaseInput.extend({
        downloadUrl: z.string().url(),
        checksum: z.string(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("fleet.agent_bulk_update_triggered", "VectorNode"))
    .mutation(async ({ input }) => {
      const windowStatus = getMaintenanceWindowStatus(input.maintenanceWindow);
      if (input.maintenanceWindow && windowStatus !== "open") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            windowStatus === "scheduled"
              ? "Maintenance window has not started"
              : "Maintenance window has expired",
        });
      }

      const { downloadUrl } = input;
      let { targetVersion, checksum } = input;

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

      const plan = await buildAgentUpgradePlan({ ...input, targetVersion });
      const activeWave = plan.waves[0];
      if (!activeWave) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No eligible agents matched the upgrade criteria",
        });
      }

      const pendingAction = {
        type: "self_update",
        targetVersion,
        downloadUrl,
        checksum,
        orchestration: {
          environmentId: input.environmentId,
          stage: activeWave.stage,
          waveIndex: activeWave.index,
          totalWaves: plan.waves.length,
          selectedAt: new Date().toISOString(),
        },
      };

      const updated = await prisma.vectorNode.updateMany({
        where: { id: { in: activeWave.nodeIds } },
        data: { pendingAction },
      });

      for (const nodeId of activeWave.nodeIds) {
        relayPush(nodeId, {
          type: "action",
          action: "self_update",
          targetVersion,
          downloadUrl,
          checksum,
        });
      }

      const remainingNodeIds = plan.waves
        .slice(1)
        .flatMap((wave) => wave.nodeIds);

      return {
        updatedCount: updated.count,
        triggeredNodeIds: activeWave.nodeIds,
        remainingNodeIds,
        plan,
      };
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
