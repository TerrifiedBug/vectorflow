import { z } from "zod";
import { router, protectedProcedure, requireOrgAdmin } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";

/**
 * Per-organisation destination price models (B3). A `DestinationCostModel` maps
 * a Vector sink type (e.g. "datadog_logs", "splunk_hec") to a $/GB price so the
 * analytics surface and cost recommendations can project dollar cost on top of
 * raw byte volume. Org-wide settings, so reads are org-scoped to any member and
 * writes require an org OWNER/ADMIN (`requireOrgAdmin`).
 */
export const costModelRouter = router({
  /** List the org's destination cost models. */
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.destinationCostModel.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { sinkType: "asc" },
    });
  }),

  /** Create or update the price model for a sink type (org admin only). */
  upsert: protectedProcedure
    .use(requireOrgAdmin())
    .use(withAudit("cost_model.upsert", "DestinationCostModel"))
    .input(
      z.object({
        sinkType: z.string().min(1).max(100),
        label: z.string().max(200).nullish(),
        pricePerGbCents: z.number().int().min(0).max(100_000_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withOrgTx(ctx.organizationId, (tx) =>
        tx.destinationCostModel.upsert({
          where: {
            organizationId_sinkType: {
              organizationId: ctx.organizationId,
              sinkType: input.sinkType,
            },
          },
          create: {
            organizationId: ctx.organizationId,
            sinkType: input.sinkType,
            label: input.label ?? null,
            pricePerGbCents: input.pricePerGbCents,
          },
          update: {
            label: input.label ?? null,
            pricePerGbCents: input.pricePerGbCents,
          },
        }),
      );
    }),

  /** Remove the price model for a sink type (org admin only). */
  delete: protectedProcedure
    .use(requireOrgAdmin())
    .use(withAudit("cost_model.delete", "DestinationCostModel"))
    .input(z.object({ sinkType: z.string().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      // Org-scoped delete. Look up the row id first so the audit log records a
      // meaningful entityId; idempotent (deleted=false when nothing matched).
      return withOrgTx(ctx.organizationId, async (tx) => {
        const existing = await tx.destinationCostModel.findUnique({
          where: {
            organizationId_sinkType: {
              organizationId: ctx.organizationId,
              sinkType: input.sinkType,
            },
          },
          select: { id: true },
        });
        if (!existing) {
          return { id: input.sinkType, sinkType: input.sinkType, deleted: false };
        }
        await tx.destinationCostModel.delete({ where: { id: existing.id } });
        return { id: existing.id, sinkType: input.sinkType, deleted: true };
      });
    }),
});
