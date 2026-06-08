import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";

/**
 * A template pack row joined with its member templates, projected to the
 * minimal shape the gallery needs (no node/edge graphs).
 */
type PackWithTemplates = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  category: string;
  icon: string | null;
  featured: boolean;
  templates: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
  }>;
};

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  category: true,
} as const;

function serializePack(pack: PackWithTemplates) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    category: pack.category,
    icon: pack.icon,
    featured: pack.featured,
    // System packs live in the default org; org-authored packs carry the
    // owning org's id. The flag lets the UI badge curated/system bundles.
    isSystem: pack.organizationId === DEFAULT_ORG_ID,
    templateCount: pack.templates.length,
    templates: pack.templates,
  };
}

export const packRouter = router({
  /**
   * List curated SYSTEM packs (default org) plus the caller's own org packs,
   * each with its member templates. Org isolation: the query is constrained
   * to `organizationId IN (default, caller-org)`; the RLS-scoped client
   * further fences a fenced (multi-tenant) role to the caller's org.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const packs = await prisma.templatePack.findMany({
      where: {
        organizationId: { in: [DEFAULT_ORG_ID, ctx.organizationId] },
      },
      include: {
        templates: {
          select: TEMPLATE_SELECT,
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ featured: "desc" }, { createdAt: "asc" }],
    });
    return packs.map(serializePack);
  }),

  /** Get a single pack (system or own-org) with its member templates. */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const pack = await prisma.templatePack.findUnique({
        where: { id: input.id },
        include: {
          templates: {
            select: TEMPLATE_SELECT,
            orderBy: { createdAt: "asc" },
          },
        },
      });

      // Org-isolation (mirrors template.get): a pack is readable only if it is
      // a system pack (default org) or belongs to the caller's org. A pack
      // from another org is invisible — 404, never a 403 side channel.
      if (
        !pack ||
        (pack.organizationId !== DEFAULT_ORG_ID &&
          pack.organizationId !== ctx.organizationId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pack not found" });
      }

      return serializePack(pack);
    }),
});
