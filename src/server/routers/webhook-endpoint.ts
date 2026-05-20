import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { AlertMetric } from "@/generated/prisma";
import { withAudit } from "@/server/middleware/audit";
import { ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import {
  encryptForOrgOrFallback,
  loadOrgDataKeyCiphertext,
} from "@/server/services/crypto-v3-callsite";
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
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.created", "WebhookEndpoint"))
    .mutation(async ({ input, ctx }) => {
      await validatePublicUrl(input.url);

      // Create the endpoint row first (without the secret) so we have a
      // real endpoint.id to use as the AAD rowId when encrypting. Using a
      // surrogate rowId (like teamId) would make the ciphertext unreadable
      // by the delivery path which decrypts with rowId=endpoint.id.
      const endpoint = await prisma.webhookEndpoint.create({
        data: {
          teamId: input.teamId,
          organizationId: ctx.organizationId,
          name: input.name,
          url: input.url,
          eventTypes: input.eventTypes,
          encryptedSecret: null,
        },
        select: { id: true, name: true, url: true, eventTypes: true, enabled: true, createdAt: true, updatedAt: true },
      });
      // Encrypt the secret with the real endpoint.id and update the row.
      // PR 9-B — v3-or-v2 wrapper; GENERIC domain matches the decrypt side.
      if (input.secret) {
        const dataKeyCiphertext = await loadOrgDataKeyCiphertext(prisma, ctx.organizationId);
        const encryptedSecret = await encryptForOrgOrFallback(input.secret, {
          orgId: ctx.organizationId,
          dataKeyCiphertext,
          domain: ENCRYPTION_DOMAINS.GENERIC,
          rowTable: "WebhookEndpoint",
          rowId: endpoint.id,
        });
        await prisma.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { encryptedSecret },
        });
      }

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
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.updated", "WebhookEndpoint"))
    .mutation(async ({ input, ctx }) => {
      // Verify ownership
      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id: input.id, teamId: input.teamId },
        select: { id: true, organizationId: true },
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
      if (input.secret !== undefined) {
        // Use the row's persisted organizationId for the AAD, not ctx.organizationId.
        // This keeps the AAD consistent between encrypt (here) and decrypt
        // (outbound-webhook.ts, which reads endpoint.organizationId from the DB).
        // For endpoints created before the organizationId column was populated,
        // the persisted value is the source of truth because delivery uses it.
        const rowOrgId = existing.organizationId;
        const dataKeyCiphertext = await loadOrgDataKeyCiphertext(prisma, rowOrgId);
        updateData.encryptedSecret = await encryptForOrgOrFallback(input.secret, {
          orgId: rowOrgId,
          dataKeyCiphertext,
          domain: ENCRYPTION_DOMAINS.GENERIC,
          rowTable: "WebhookEndpoint",
          rowId: existing.id,
        });
      }

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
    .use(denyInDemo())
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
    .use(denyInDemo())
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
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("webhookEndpoint.testDelivery", "WebhookEndpoint"))
    .mutation(async ({ input }) => {
      const endpoint = await prisma.webhookEndpoint.findFirst({
        where: { id: input.id, teamId: input.teamId },
        select: {
          id: true,
          url: true,
          encryptedSecret: true,
          organizationId: true,
          // Phase 5aa: include confirmedAt so the delivery call below sees
          // an explicit confirmation status. Test delivery against an
          // unconfirmed endpoint must still fail closed.
          confirmedAt: true,
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
        {
          url: endpoint.url,
          encryptedSecret: endpoint.encryptedSecret,
          id: endpoint.id,
          organizationId: endpoint.organizationId,
          confirmedAt: endpoint.confirmedAt,
        },
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
