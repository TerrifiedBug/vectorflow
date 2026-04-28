import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import type { ChannelPayload } from "@/server/services/channels/types";
import { getDriver } from "@/server/services/channels";

export const alertDeliveriesRouter = router({
  listDeliveries: protectedProcedure
    .input(z.object({ alertEventId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.deliveryAttempt.findMany({
        where: { alertEventId: input.alertEventId },
        select: {
          id: true,
          channelType: true,
          channelName: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          requestedAt: true,
          completedAt: true,
          attemptNumber: true,
        },
        orderBy: { requestedAt: "desc" },
      });
    }),

  listChannelDeliveries: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        channelName: z.string(),
        channelType: z.string(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.deliveryAttempt.findMany({
        where: {
          channelName: input.channelName,
          channelType: input.channelType,
          alertEvent: {
            alertRule: { environmentId: input.environmentId },
          },
        },
        select: {
          id: true,
          channelType: true,
          channelName: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          requestedAt: true,
          completedAt: true,
          attemptNumber: true,
        },
        orderBy: { requestedAt: "desc" },
        take: input.limit,
      });
    }),

  retryDelivery: protectedProcedure
    .input(z.object({ deliveryAttemptId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alert.retryDelivery", "DeliveryAttempt"))
    .mutation(async ({ input }) => {
      const attempt = await prisma.deliveryAttempt.findUnique({
        where: { id: input.deliveryAttemptId },
        include: {
          alertEvent: {
            include: {
              alertRule: {
                include: {
                  environment: { select: { name: true, team: { select: { name: true } } } },
                  pipeline: { select: { name: true } },
                },
              },
              node: { select: { host: true } },
            },
          },
        },
      });

      if (!attempt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Delivery attempt not found" });
      }

      if (attempt.status !== "failed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only failed deliveries can be retried" });
      }

      const event = attempt.alertEvent;
      if (!event?.alertRule) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Associated alert event or rule not found" });
      }

      const rule = event.alertRule;
      const payload: ChannelPayload = {
        alertId: event.id,
        status: event.status === "resolved" ? "resolved" : "firing",
        ruleName: rule.name,
        severity: "warning",
        environment: rule.environment.name,
        team: rule.environment.team?.name,
        node: event.node?.host ?? undefined,
        pipeline: rule.pipeline?.name ?? undefined,
        metric: rule.metric,
        value: event.value,
        threshold: rule.threshold ?? 0,
        message: event.message ?? "",
        timestamp: event.firedAt.toISOString(),
        dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
      };

      const nextAttemptNumber = attempt.attemptNumber + 1;

      if (!attempt.channelId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Delivery attempt has no target channel" });
      }

      const channel = await prisma.notificationChannel.findUnique({ where: { id: attempt.channelId } });
      if (!channel) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Notification channel not found" });
      }
      const { trackChannelDelivery } = await import("@/server/services/delivery-tracking");
      const channelDriver = getDriver(channel.type);
      await trackChannelDelivery(
        event.id,
        channel.id,
        channel.type,
        channel.name,
        async () => {
          const result = await channelDriver.deliver(channel.config as Record<string, unknown>, payload);
          return { success: result.success, error: result.error };
        },
        nextAttemptNumber,
      );

      return { success: true };
    }),

  listFailedDeliveries: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.deliveryAttempt.findMany({
        where: {
          status: "failed",
          alertEvent: {
            alertRule: {
              environmentId: input.environmentId,
            },
          },
        },
        select: {
          id: true,
          channelType: true,
          channelName: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          requestedAt: true,
          completedAt: true,
          attemptNumber: true,
          alertEventId: true,
          alertEvent: {
            select: {
              alertRule: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: { requestedAt: "desc" },
        take: input.limit,
      });
    }),

  retryAllForChannel: protectedProcedure
    .input(
      z.object({
        channelName: z.string(),
        channelType: z.string(),
        environmentId: z.string(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alert.retryAllForChannel", "DeliveryAttempt"))
    .mutation(async ({ input }) => {
      const failedAttempts = await prisma.deliveryAttempt.findMany({
        where: {
          status: "failed",
          channelName: input.channelName,
          channelType: input.channelType,
          alertEvent: {
            alertRule: {
              environmentId: input.environmentId,
            },
          },
        },
        select: { id: true },
        take: 50,
      });

      const ids = failedAttempts.map((a) => a.id);
      if (ids.length > 0) {
        await prisma.deliveryAttempt.updateMany({
          where: { id: { in: ids } },
          data: { nextRetryAt: new Date() },
        });
      }

      return { retriedCount: ids.length, totalFailed: failedAttempts.length };
    }),
});
