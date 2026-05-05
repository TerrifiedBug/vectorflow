import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { nodeMatchesGroup } from "@/lib/node-group-utils";

export const nodeGroupRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.nodeGroup.findMany({
        where: { environmentId: input.environmentId },
        orderBy: { name: "asc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100),
        criteria: z.record(z.string(), z.string()).default({}),
        labelTemplate: z.record(z.string(), z.string()).default({}),
        requiredLabels: z.array(z.string()).default([]),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("nodeGroup.created", "NodeGroup"))
    .mutation(async ({ input }) => {
      // Validate unique name per environment
      const existing = await prisma.nodeGroup.findUnique({
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
          message: `A node group named "${input.name}" already exists in this environment`,
        });
      }

      return prisma.nodeGroup.create({
        data: {
          name: input.name,
          environmentId: input.environmentId,
          criteria: input.criteria,
          labelTemplate: input.labelTemplate,
          requiredLabels: input.requiredLabels,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        criteria: z.record(z.string(), z.string()).optional(),
        labelTemplate: z.record(z.string(), z.string()).optional(),
        requiredLabels: z.array(z.string()).optional(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("nodeGroup.updated", "NodeGroup"))
    .mutation(async ({ input }) => {
      const group = await prisma.nodeGroup.findUnique({
        where: { id: input.id },
        select: { id: true, environmentId: true, name: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node group not found",
        });
      }

      // Validate unique name if name is being changed
      if (input.name && input.name !== group.name) {
        const existing = await prisma.nodeGroup.findUnique({
          where: {
            environmentId_name: {
              environmentId: group.environmentId,
              name: input.name,
            },
          },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A node group named "${input.name}" already exists in this environment`,
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.criteria !== undefined) data.criteria = input.criteria;
      if (input.labelTemplate !== undefined) data.labelTemplate = input.labelTemplate;
      if (input.requiredLabels !== undefined) data.requiredLabels = input.requiredLabels;

      return prisma.nodeGroup.update({
        where: { id: input.id },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("nodeGroup.deleted", "NodeGroup"))
    .mutation(async ({ input }) => {
      const group = await prisma.nodeGroup.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node group not found",
        });
      }

      return prisma.nodeGroup.delete({
        where: { id: input.id },
      });
    }),

  /**
   * NODE-04: Aggregated per-group health stats for the fleet dashboard.
   * Single round trip: 3 parallel queries, application-layer aggregation.
   */
  groupHealthStats: protectedProcedure
    .input(z.object({ environmentId: z.string(), labels: z.record(z.string(), z.string()).optional() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { environmentId } = input;

      const [nodes, groups, firingAlerts, pipelineStatuses, pipelines] = await Promise.all([
        prisma.vectorNode.findMany({
          where: { environmentId },
          select: { id: true, status: true, labels: true },
        }),
        prisma.nodeGroup.findMany({
          where: { environmentId },
          orderBy: { name: "asc" },
        }),
        prisma.alertEvent.findMany({
          where: { status: "firing", node: { environmentId } },
          select: { nodeId: true },
        }),
        prisma.nodePipelineStatus.findMany({
          where: {
            node: { environmentId },
          },
          select: {
            nodeId: true,
            pipelineId: true,
            version: true,
            configChecksum: true,
          },
        }),
        prisma.pipeline.findMany({
          where: {
            environmentId,
            isDraft: false,
            deployedAt: { not: null },
          },
          select: {
            id: true,
            versions: {
              orderBy: { version: "desc" as const },
              take: 1,
              select: { version: true },
            },
          },
        }),
      ]);

      const scopedNodes = filterNodesByLabels(nodes, input.labels);

      // Build latest version map for drift detection
      const latestVersionMap = new Map<string, number>();
      for (const p of pipelines) {
        latestVersionMap.set(p.id, p.versions[0]?.version ?? 1);
      }

      // Index pipeline statuses by nodeId
      const statusesByNode = new Map<string, typeof pipelineStatuses>();
      for (const s of pipelineStatuses) {
        const existing = statusesByNode.get(s.nodeId) ?? [];
        existing.push(s);
        statusesByNode.set(s.nodeId, existing);
      }

      const firingNodeIds = new Set(
        firingAlerts.map((a) => a.nodeId).filter(Boolean) as string[],
      );

      const assignedNodeIds = new Set<string>();

      const groupStats = groups.map((group) => {
        const criteria = group.criteria as Record<string, string>;
        const requiredLabels = group.requiredLabels as string[];

        const matchedNodes = scopedNodes.filter((n) => {
          const nodeLabels = (n.labels as Record<string, string>) ?? {};
          return nodeMatchesGroup(nodeLabels, criteria);
        });

        for (const n of matchedNodes) {
          assignedNodeIds.add(n.id);
        }

        const totalNodes = matchedNodes.length;
        const onlineCount = matchedNodes.filter((n) => n.status === "HEALTHY").length;
        const alertCount = matchedNodes.filter((n) => firingNodeIds.has(n.id)).length;

        let complianceRate = 100;
        if (requiredLabels.length > 0 && totalNodes > 0) {
          const compliantCount = matchedNodes.filter((n) => {
            const nodeLabels = (n.labels as Record<string, string>) ?? {};
            return requiredLabels.every((key) =>
              Object.prototype.hasOwnProperty.call(nodeLabels, key),
            );
          }).length;
          complianceRate = Math.round((compliantCount / totalNodes) * 100);
        }

        // Version drift: count pipelines where this group's nodes run a non-latest version
        let versionDriftCount = 0;
        const configDriftCount = 0;
        let totalPipelineSlots = 0;

        for (const n of matchedNodes) {
          const nodeStatuses = statusesByNode.get(n.id) ?? [];
          totalPipelineSlots += nodeStatuses.length;
          for (const ps of nodeStatuses) {
            const latest = latestVersionMap.get(ps.pipelineId);
            if (latest !== undefined && ps.version !== latest) {
              versionDriftCount++;
            }
            // Config drift is tracked separately via alert evaluator;
            // configDriftCount stays 0 here since we can't compare without
            // the expected checksum cache in this context.
          }
        }

        const versionCompliance = totalPipelineSlots > 0
          ? Math.round(((totalPipelineSlots - versionDriftCount) / totalPipelineSlots) * 100)
          : 100;

        // Combined: average of label compliance and version compliance
        const overallCompliance = Math.round((complianceRate + versionCompliance) / 2);

        return {
          ...group,
          totalNodes,
          onlineCount,
          alertCount,
          complianceRate,
          versionDriftCount,
          configDriftCount,
          overallCompliance,
        };
      });

      // Synthetic "Ungrouped" entry for nodes not matching any group
      const ungroupedNodes = scopedNodes.filter((n) => !assignedNodeIds.has(n.id));
      if (ungroupedNodes.length > 0) {
        const ungroupedOnlineCount = ungroupedNodes.filter((n) => n.status === "HEALTHY").length;
        const ungroupedAlertCount = ungroupedNodes.filter((n) => firingNodeIds.has(n.id)).length;
        groupStats.push({
          id: "__ungrouped__",
          name: "Ungrouped",
          environmentId,
          criteria: {},
          labelTemplate: {},
          requiredLabels: [],
          createdAt: new Date(0),
          updatedAt: new Date(0),
          totalNodes: ungroupedNodes.length,
          onlineCount: ungroupedOnlineCount,
          alertCount: ungroupedAlertCount,
          complianceRate: 100,
          versionDriftCount: 0,
          configDriftCount: 0,
          overallCompliance: 100,
        });
      }

      return groupStats;
    }),

  /**
   * NODE-05: Per-node detail for a group, sorted by health status (worst first).
   * Used for the drill-down view in the fleet health dashboard.
   */
  nodesInGroup: protectedProcedure
    .input(z.object({ groupId: z.string(), environmentId: z.string(), labels: z.record(z.string(), z.string()).optional() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { groupId, environmentId } = input;

      let groupCriteria: Record<string, string> = {};
      let requiredLabels: string[] = [];

      if (groupId === "__ungrouped__") {
        // Fetch all groups to determine which nodes are ungrouped
        const allGroups = await prisma.nodeGroup.findMany({
          where: { environmentId },
        });

        const allNodes = await prisma.vectorNode.findMany({
          where: { environmentId },
          select: {
            id: true,
            name: true,
            status: true,
            labels: true,
            lastSeen: true,
            nodeMetrics: {
              orderBy: { timestamp: "desc" },
              take: 1,
              select: { loadAvg1: true },
            },
          },
        });

        const assignedIds = new Set<string>();
        for (const group of allGroups) {
          const criteria = group.criteria as Record<string, string>;
          for (const n of allNodes) {
            const nodeLabels = (n.labels as Record<string, string>) ?? {};
            if (nodeMatchesGroup(nodeLabels, criteria)) {
              assignedIds.add(n.id);
            }
          }
        }

        const scopedNodes = filterNodesByLabels(allNodes, input.labels);
        const ungroupedNodes = scopedNodes.filter((n) => !assignedIds.has(n.id));
        return sortAndMapNodes(ungroupedNodes, []);
      }

      // Normal group lookup — scoped to input.environmentId to prevent cross-team data exposure
      const group = await prisma.nodeGroup.findFirst({
        where: { id: groupId, environmentId },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Node group not found",
        });
      }

      groupCriteria = group.criteria as Record<string, string>;
      requiredLabels = group.requiredLabels as string[];

      const allNodes = await prisma.vectorNode.findMany({
        where: { environmentId },
        select: {
          id: true,
          name: true,
          status: true,
          labels: true,
          lastSeen: true,
          nodeMetrics: {
            orderBy: { timestamp: "desc" },
            take: 1,
            select: { loadAvg1: true },
          },
        },
      });

      const scopedNodes = filterNodesByLabels(allNodes, input.labels);
      const matchedNodes = scopedNodes.filter((n) => {
        const nodeLabels = (n.labels as Record<string, string>) ?? {};
        return nodeMatchesGroup(nodeLabels, groupCriteria);
      });

      return sortAndMapNodes(matchedNodes, requiredLabels);
    }),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  UNREACHABLE: 0,
  DEGRADED: 1,
  UNKNOWN: 2,
  HEALTHY: 3,
};

function filterNodesByLabels<T extends { labels: unknown }>(
  nodes: T[],
  labels?: Record<string, string>,
): T[] {
  if (!labels || Object.keys(labels).length === 0) return nodes;
  return nodes.filter((node) => {
    const nodeLabels = (node.labels as Record<string, string>) ?? {};
    return Object.entries(labels).every(([key, value]) => nodeLabels[key] === value);
  });
}

function sortAndMapNodes(
  nodes: Array<{
    id: string;
    name: string;
    status: string;
    labels: unknown;
    lastSeen: Date | null;
    nodeMetrics: Array<{ loadAvg1: number }>;
  }>,
  requiredLabels: string[],
) {
  return nodes
    .map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
      labels: n.labels,
      lastSeen: n.lastSeen,
      cpuLoad: n.nodeMetrics[0]?.loadAvg1 ?? null,
      labelCompliant:
        requiredLabels.length === 0 ||
        requiredLabels.every((key) =>
          Object.prototype.hasOwnProperty.call(
            (n.labels as Record<string, string>) ?? {},
            key,
          ),
        ),
    }))
    .sort((a, b) => {
      const statusDiff =
        (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      return a.name.localeCompare(b.name);
    });
}
