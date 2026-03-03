import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { Prisma, AlertMetric, AlertCondition } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import crypto from "crypto";

export const alertRouter = router({
  // ─── Alert Rules ───────────────────────────────────────────────────

  listRules: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.alertRule.findMany({
        where: { environmentId: input.environmentId },
        include: {
          pipeline: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  createRule: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        environmentId: z.string(),
        pipelineId: z.string().optional(),
        metric: z.nativeEnum(AlertMetric),
        condition: z.nativeEnum(AlertCondition),
        threshold: z.number(),
        durationSeconds: z.number().int().min(1).default(60),
        teamId: z.string(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.created", "AlertRule"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      if (input.pipelineId) {
        const pipeline = await prisma.pipeline.findUnique({
          where: { id: input.pipelineId },
        });
        if (!pipeline || pipeline.environmentId !== input.environmentId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pipeline not found in this environment",
          });
        }
      }

      return prisma.alertRule.create({
        data: {
          name: input.name,
          environmentId: input.environmentId,
          pipelineId: input.pipelineId,
          teamId: input.teamId,
          metric: input.metric,
          condition: input.condition,
          threshold: input.threshold,
          durationSeconds: input.durationSeconds,
        },
      });
    }),

  updateRule: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        enabled: z.boolean().optional(),
        threshold: z.number().optional(),
        durationSeconds: z.number().int().min(1).optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.updated", "AlertRule"))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const existing = await prisma.alertRule.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert rule not found",
        });
      }

      return prisma.alertRule.update({
        where: { id },
        data,
      });
    }),

  deleteRule: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertRule.deleted", "AlertRule"))
    .mutation(async ({ input }) => {
      const existing = await prisma.alertRule.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert rule not found",
        });
      }

      await prisma.alertRule.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  // ─── Alert Webhooks ────────────────────────────────────────────────

  listWebhooks: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.alertWebhook.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          environmentId: true,
          url: true,
          headers: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  createWebhook: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        url: z.string().url(),
        headers: z.record(z.string(), z.string()).optional(),
        hmacSecret: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertWebhook.created", "AlertWebhook"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      return prisma.alertWebhook.create({
        data: {
          environmentId: input.environmentId,
          url: input.url,
          headers: input.headers ?? undefined,
          hmacSecret: input.hmacSecret,
        },
      });
    }),

  updateWebhook: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        url: z.string().url().optional(),
        headers: z.record(z.string(), z.string()).nullable().optional(),
        hmacSecret: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertWebhook.updated", "AlertWebhook"))
    .mutation(async ({ input }) => {
      const { id, headers, ...rest } = input;
      const existing = await prisma.alertWebhook.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert webhook not found",
        });
      }

      return prisma.alertWebhook.update({
        where: { id },
        data: {
          ...rest,
          ...(headers !== undefined
            ? { headers: headers === null ? Prisma.DbNull : headers }
            : {}),
        },
      });
    }),

  deleteWebhook: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("alertWebhook.deleted", "AlertWebhook"))
    .mutation(async ({ input }) => {
      const existing = await prisma.alertWebhook.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert webhook not found",
        });
      }

      await prisma.alertWebhook.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  testWebhook: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const webhook = await prisma.alertWebhook.findUnique({
        where: { id: input.id },
        include: { environment: { select: { name: true } } },
      });
      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert webhook not found",
        });
      }

      const payload = {
        alertId: "test-alert-id",
        status: "firing" as const,
        ruleName: "Test Alert Rule",
        severity: "warning",
        environment: webhook.environment.name,
        metric: "cpu_usage",
        value: 85.5,
        threshold: 80,
        message: "This is a test alert from VectorFlow",
        timestamp: new Date().toISOString(),
        dashboardUrl: "",
      };

      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...((webhook.headers as Record<string, string>) ?? {}),
      };

      if (webhook.hmacSecret) {
        const signature = crypto
          .createHmac("sha256", webhook.hmacSecret)
          .update(body)
          .digest("hex");
        headers["X-VectorFlow-Signature"] = `sha256=${signature}`;
      }

      try {
        const res = await fetch(webhook.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(10000),
        });

        return {
          success: res.ok,
          statusCode: res.status,
          statusText: res.statusText,
        };
      } catch (err) {
        return {
          success: false,
          statusCode: 0,
          statusText: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }),

  // ─── Alert Events ──────────────────────────────────────────────────

  listEvents: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        limit: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { environmentId, limit, cursor } = input;

      const items = await prisma.alertEvent.findMany({
        where: {
          alertRule: { environmentId },
        },
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
});
