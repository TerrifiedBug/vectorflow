import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import crypto from "crypto";
import {
  type WebhookPayload,
  formatWebhookMessage,
} from "@/server/services/webhook-delivery";
import { validatePublicUrl } from "@/server/services/url-validation";

export const alertWebhooksRouter = router({
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
      await validatePublicUrl(input.url);
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
      if (input.url) {
        await validatePublicUrl(input.url);
      }
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
    .use(withAudit("alertWebhook.tested", "AlertWebhook"))
    .mutation(async ({ input }) => {
      const webhook = await prisma.alertWebhook.findUnique({
        where: { id: input.id },
        include: {
          environment: {
            select: { name: true, team: { select: { name: true } } },
          },
        },
      });
      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert webhook not found",
        });
      }

      await validatePublicUrl(webhook.url);

      const payload: WebhookPayload = {
        alertId: "test-alert-id",
        status: "firing",
        ruleName: "Test Alert Rule",
        severity: "warning",
        environment: webhook.environment.name,
        team: webhook.environment.team?.name,
        node: "test-node.example.com",
        metric: "cpu_usage",
        value: 85.5,
        threshold: 80,
        message: "CPU usage is 85.50 (threshold: > 80)",
        timestamp: new Date().toISOString(),
        dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
      };

      const outgoing = {
        ...payload,
        content: formatWebhookMessage(payload),
      };

      const body = JSON.stringify(outgoing);
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
});
