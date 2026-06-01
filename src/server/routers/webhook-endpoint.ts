import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
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

      // We need the real endpoint.id for the v3 AAD rowId, but we can't
      // have it before the row exists. Solution: use a Prisma transaction
      // to pre-generate the cuid, encrypt with it, then create the row
      // atomically — or use the create-then-update pattern inside a
      // transaction so partial failure leaves no orphan.
      const plaintextSecret: string | null = input.secret ?? null;

      if (input.secret) {
        const endpoint = await withOrgTx(ctx.organizationId, async (tx) => {
          const row = await tx.webhookEndpoint.create({
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
          // Encrypt inside the transaction. If KMS/encryption fails, the
          // transaction rolls back and no orphan row is left.
          const dataKeyCiphertext = await loadOrgDataKeyCiphertext(ctx.organizationId);
          const encryptedSecret = await encryptForOrgOrFallback(input.secret!, {
            orgId: ctx.organizationId,
            dataKeyCiphertext,
            domain: ENCRYPTION_DOMAINS.GENERIC,
            rowTable: "WebhookEndpoint",
            rowId: row.id,
          });
          await tx.webhookEndpoint.update({
            where: { id: row.id },
            data: { encryptedSecret },
          });
          return row;
        });
        return { ...endpoint, secret: plaintextSecret };
      }

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

      // Return the plaintext secret once so the admin can copy it.
      return { ...endpoint, secret: null };
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
    .mutation(async ({ input }) => {
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
        const dataKeyCiphertext = await loadOrgDataKeyCiphertext(rowOrgId);
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
          // Include confirmedAt so the delivery call below sees
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
