import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, AlertMetric } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";

function withMixedTimeline<
  T extends {
    events: Array<{ firedAt: Date }>;
    anomalyEvents: Array<{ detectedAt: Date }>;
  },
>(group: T) {
  const timeline = [
    ...group.events.map((event) => ({
      ...event,
      kind: "alert" as const,
      timestamp: event.firedAt,
    })),
    ...group.anomalyEvents.map((event) => ({
      ...event,
      kind: "anomaly" as const,
      timestamp: event.detectedAt,
    })),
  ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return { ...group, timeline };
}

export const alertEventsRouter = router({
  listEvents: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        limit: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
        status: z.enum(["firing", "resolved", "acknowledged", "dismissed"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { environmentId, limit, cursor, status, dateFrom, dateTo } = input;

      // Exclude informational event metrics (deploys, version checks) from history;
      // they still fire notifications but aren't surfaced in the alert table.
      const HIDDEN_METRICS: AlertMetric[] = [
        "deploy_requested",
        "deploy_completed",
        "deploy_rejected",
        "deploy_cancelled",
        "new_version_available",
      ];

      const where: Prisma.AlertEventWhereInput = {
        alertRule: { environmentId, metric: { notIn: HIDDEN_METRICS } },
        ...(status ? { status } : {}),
        ...(dateFrom ?? dateTo
          ? {
              firedAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo + "T23:59:59.999Z") } : {}),
              },
            }
          : {}),
      };

      const items = await prisma.alertEvent.findMany({
        where,
        include: {
          alertRule: {
            select: {
              id: true,
              name: true,
              metric: true,
              condition: true,
              threshold: true,
              pipeline: { select: { id: true, name: true } },
            },
          },
          node: {
            select: { id: true, host: true },
          },
        },
        orderBy: { firedAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return { items, nextCursor };
    }),

  acknowledgeEvent: protectedProcedure
    .input(z.object({ alertEventId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertEvent.acknowledged", "AlertEvent"))
    .mutation(async ({ input, ctx }) => {
      const event = await prisma.alertEvent.findUnique({
        where: { id: input.alertEventId },
      });
      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert event not found",
        });
      }
      if (event.status !== "firing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only firing alerts can be acknowledged",
        });
      }

      const user = ctx.session.user;
      const acknowledgedBy =
        user?.email || user?.name || user?.id || "unknown";

      return prisma.alertEvent.update({
        where: { id: input.alertEventId },
        data: {
          status: "acknowledged",
          acknowledgedAt: new Date(),
          acknowledgedBy,
        },
      });
    }),

  bulkAcknowledge: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        alertEventIds: z.array(z.string()).min(1).max(100),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertEvent.bulkAcknowledged", "AlertEvent"))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user;
      const acknowledgedBy =
        user?.email || user?.name || user?.id || "unknown";

      // Scope through alertRule → environment to prevent cross-team access
      const result = await prisma.alertEvent.updateMany({
        where: {
          id: { in: input.alertEventIds },
          status: "firing",
          alertRule: { environmentId: input.environmentId },
        },
        data: {
          status: "acknowledged",
          acknowledgedAt: new Date(),
          acknowledgedBy,
        },
      });

      return { updated: result.count, total: input.alertEventIds.length };
    }),

  bulkDismiss: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        alertEventIds: z.array(z.string()).min(1).max(100),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertEvent.bulkDismissed", "AlertEvent"))
    .mutation(async ({ input }) => {
      // Scope through alertRule → environment to prevent cross-team access
      const result = await prisma.alertEvent.updateMany({
        where: {
          id: { in: input.alertEventIds },
          status: { in: ["firing", "acknowledged"] },
          alertRule: { environmentId: input.environmentId },
        },
        data: {
          status: "dismissed",
        },
      });

      return { updated: result.count, total: input.alertEventIds.length };
    }),

  listCorrelationGroups: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        limit: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
        status: z.enum(["firing", "resolved", "acknowledged"]).optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { environmentId, limit, cursor, status } = input;

      const where: Prisma.AlertCorrelationGroupWhereInput = {
        environmentId,
        ...(status ? { status } : {}),
      };

      const items = await prisma.alertCorrelationGroup.findMany({
        where,
        include: {
          events: {
            include: {
              alertRule: {
                select: {
                  id: true,
                  name: true,
                  metric: true,
                  condition: true,
                  threshold: true,
                  pipeline: { select: { id: true, name: true } },
                },
              },
              node: { select: { id: true, host: true } },
            },
            take: 3, // Preview: first 3 events for the summary row
            orderBy: { firedAt: "asc" },
          },
          anomalyEvents: {
            include: {
              pipeline: { select: { id: true, name: true } },
            },
            take: 3,
            orderBy: { detectedAt: "asc" },
          },
        },
        orderBy: { openedAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return { items: items.map(withMixedTimeline), nextCursor };
    }),

  getCorrelationGroup: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const group = await prisma.alertCorrelationGroup.findUnique({
        where: { id: input.id },
        include: {
          events: {
            include: {
              alertRule: {
                select: {
                  id: true,
                  name: true,
                  metric: true,
                  condition: true,
                  threshold: true,
                  pipeline: { select: { id: true, name: true } },
                },
              },
              node: { select: { id: true, host: true } },
            },
            orderBy: { firedAt: "asc" },
          },
          anomalyEvents: {
            include: {
              pipeline: { select: { id: true, name: true } },
            },
            orderBy: { detectedAt: "asc" },
          },
        },
      });

      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Correlation group not found",
        });
      }

      return withMixedTimeline(group);
    }),

  acknowledgeGroup: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertGroup.acknowledged", "AlertCorrelationGroup"))
    .mutation(async ({ input, ctx }) => {
      const group = await prisma.alertCorrelationGroup.findUnique({
        where: { id: input.groupId },
      });
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Correlation group not found",
        });
      }

      const user = ctx.session.user;
      const acknowledgedBy =
        user?.email || user?.name || user?.id || "unknown";

      // Acknowledge all firing events in the group
      await prisma.alertEvent.updateMany({
        where: {
          correlationGroupId: input.groupId,
          status: "firing",
        },
        data: {
          status: "acknowledged",
          acknowledgedAt: new Date(),
          acknowledgedBy,
        },
      });

      return { success: true };
    }),
});
