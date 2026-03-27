import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { AlertMetric } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import { encrypt } from "@/server/services/crypto";
import { validatePublicUrl } from "@/server/services/url-validation";
import { deliverOutboundWebhook } from "@/server/services/outbound-webhook";

// ─── Shared select shape (never includes encryptedSecret) ───────────────────

const ENDPOINT_SELECT = {
  id: true,
  name: true,
  url: true,
  eventTypes: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── Router ─────────────────────────────────────────────────────────────────

export const webhookEndpointRouter = router({

  /**
   * List all webhook endpoints for a team.
   * Excludes encryptedSecret — it is never returned after creation.
   */
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.webhookEndpoint.findMany({
        where: { teamId: input.teamId },
        select: ENDPOINT_SELECT,
        orderBy: { createdAt: "desc" },
      });
    }),

  /**
   * Create a new webhook endpoint.
   * Validates URL against SSRF, encrypts the secret if provided.
   * Returns the plaintext secret ONCE on creation (never again).
   */
  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string().min(1).max(200),
        url: z.string().url(),
        eventTypes: z.array(z.nativeEnum(AlertMetric)).min(1),
        secret: z.string().min(1).optional(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.created", "WebhookEndpoint"))
    .mutation(async ({ input }) => {
      await validatePublicUrl(input.url);

      const encryptedSecret = input.secret ? encrypt(input.secret) : null;

      const endpoint = await prisma.webhookEndpoint.create({
        data: {
          teamId: input.teamId,
          name: input.name,
          url: input.url,
          eventTypes: input.eventTypes,
          encryptedSecret,
        },
        select: ENDPOINT_SELECT,
      });

      // Return the plaintext secret once so the admin can copy it.
      // After this response, the secret is never exposed again.
      return {
        ...endpoint,
        secret: input.secret ?? null,
      };
    }),

  /**
   * Update an existing webhook endpoint.
   * Only provided fields are updated. URL is re-validated if changed.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        teamId: z.string(),
        name: z.string().min(1).max(200).optional(),
        url: z.string().url().optional(),
        eventTypes: z.array(z.nativeEnum(AlertMetric)).min(1).optional(),
        secret: z.string().min(1).optional(),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.updated", "WebhookEndpoint"))
    .mutation(async ({ input }) => {
      // Verify ownership
      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id: input.id, teamId: input.teamId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook endpoint not found" });
      }

      if (input.url) {
        await validatePublicUrl(input.url);
      }

      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.url !== undefined) updateData.url = input.url;
      if (input.eventTypes !== undefined) updateData.eventTypes = input.eventTypes;
      if (input.secret !== undefined) updateData.encryptedSecret = encrypt(input.secret);

      return prisma.webhookEndpoint.update({
        where: { id: input.id },
        data: updateData,
        select: ENDPOINT_SELECT,
      });
    }),

  /**
   * Delete a webhook endpoint (and cascade its deliveries).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.deleted", "WebhookEndpoint"))
    .mutation(async ({ input }) => {
      // Verify the endpoint belongs to this team before deleting
      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id: input.id, teamId: input.teamId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook endpoint not found" });
      }

      await prisma.webhookEndpoint.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  /**
   * Toggle the enabled flag on a webhook endpoint.
   */
  toggleEnabled: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.toggled", "WebhookEndpoint"))
    .mutation(async ({ input }) => {
      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id: input.id, teamId: input.teamId },
        select: { id: true, enabled: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook endpoint not found" });
      }

      return prisma.webhookEndpoint.update({
        where: { id: input.id },
        data: { enabled: !existing.enabled },
        select: ENDPOINT_SELECT,
      });
    }),

  /**
   * Send a test delivery to a webhook endpoint.
   * Returns the OutboundResult directly so the caller can report success/failure.
   */
  testDelivery: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.testDelivery", "WebhookEndpoint"))
    .mutation(async ({ input }) => {
      const endpoint = await prisma.webhookEndpoint.findFirst({
        where: { id: input.id, teamId: input.teamId },
        select: {
          id: true,
          url: true,
          encryptedSecret: true,
        },
      });
      if (!endpoint) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook endpoint not found" });
      }

      const testPayload = {
        type: "test",
        timestamp: new Date().toISOString(),
        data: {
          message: "Test delivery from VectorFlow",
          endpointId: input.id,
        },
      };

      return deliverOutboundWebhook(
        { url: endpoint.url, encryptedSecret: endpoint.encryptedSecret, id: endpoint.id },
        testPayload,
      );
    }),

  /**
   * List delivery history for a webhook endpoint with cursor pagination.
   */
  listDeliveries: protectedProcedure
    .input(
      z.object({
        webhookEndpointId: z.string(),
        teamId: z.string(),
        take: z.number().min(1).max(100).default(20),
        skip: z.number().min(0).default(0),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      // Verify endpoint belongs to the team
      const endpoint = await prisma.webhookEndpoint.findFirst({
        where: { id: input.webhookEndpointId, teamId: input.teamId },
        select: { id: true },
      });
      if (!endpoint) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook endpoint not found" });
      }

      const [deliveries, total] = await Promise.all([
        prisma.webhookDelivery.findMany({
          where: { webhookEndpointId: input.webhookEndpointId },
          orderBy: { requestedAt: "desc" },
          take: input.take,
          skip: input.skip,
        }),
        prisma.webhookDelivery.count({
          where: { webhookEndpointId: input.webhookEndpointId },
        }),
      ]);

      return { deliveries, total };
    }),
});
