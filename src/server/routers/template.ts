import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess, roleLevel } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { isOrgWideAdmin } from "@/lib/org-admin";
import { getCompliancePresets } from "@/server/services/dlp-templates/compliance-presets";

const templateNodeSchema = z.object({
  id: z.string(),
  componentType: z.string(),
  componentKey: z.string().min(1).max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  displayName: z.string().max(64).nullable().optional(),
  kind: z.enum(["source", "transform", "sink"]),
  config: z.record(z.string(), z.any()),
  positionX: z.number(),
  positionY: z.number(),
});

const templateEdgeSchema = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  sourcePort: z.string().optional(),
});

export const templateRouter = router({
  /** List all templates for a team */
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const templates = await prisma.template.findMany({
        where: {
          OR: [
            { teamId: input.teamId },
            { teamId: null },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        teamId: t.teamId,
        nodes: t.nodes as unknown[],
        nodeCount: Array.isArray(t.nodes) ? (t.nodes as unknown[]).length : 0,
        edgeCount: Array.isArray(t.edges) ? (t.edges as unknown[]).length : 0,
        createdAt: t.createdAt,
      }));
    }),

  /**
   * DLP compliance presets (PCI-DSS / HIPAA / GDPR), derived from the DLP
   * template catalog's compliance tags. Static catalog data — safe for any
   * authenticated user; no tenant-scoped input.
   */
  dlpCompliancePresets: protectedProcedure.query(() => getCompliancePresets()),

  /** Get a single template by ID */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const template = await prisma.template.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          nodes: true,
          edges: true,
          teamId: true,
          team: { select: { organizationId: true } },
        },
      });
      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // PR #380 P1: org-isolation — org admin sees only their own org's templates.
      // An org admin on org-A must not be able to read a template owned by org-B's team.
      if (template.teamId !== null && template.team?.organizationId !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Codex P1 round-9 finding (PR #336 audit harness): templates with
      // a non-null teamId belong to a specific team. Any authenticated
      // user could previously read another team\'s template body. Inline
      // auth: system templates (teamId === null) are readable by all
      // signed-in users; team-owned templates require membership or
      // super-admin.
      if (template.teamId !== null) {
        const userId = ctx.session.user?.id;
        if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        const orgAdmin = await isOrgWideAdmin(userId, ctx.organizationId);
        if (!orgAdmin) {
          const membership = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId, teamId: template.teamId } },
            select: { role: true },
          });
          if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
        }
      }

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        nodes: template.nodes as unknown[],
        edges: template.edges as unknown[],
      };
    }),

  /** Create a custom template (EDITOR+ role) */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().min(1),
        category: z.string().min(1),
        teamId: z.string(),
        nodes: z.array(templateNodeSchema),
        edges: z.array(templateEdgeSchema),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("template.created", "Template"))
    .mutation(async ({ input }) => {
      // Verify team exists
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
      });
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }

      return prisma.template.create({
        data: {
          name: input.name,
          description: input.description,
          category: input.category,
          teamId: input.teamId,
          nodes: input.nodes as Prisma.InputJsonValue,
          edges: input.edges as Prisma.InputJsonValue,
        },
      });
    }),

  /** Delete a template */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withAudit("template.deleted", "Template"))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.template.findUnique({
        where: { id: input.id },
        select: { id: true, teamId: true, team: { select: { organizationId: true } } },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      if (existing.teamId === null) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "System templates cannot be deleted",
        });
      }

      // PR #380 P1: org-isolation — org admin cannot delete a template from another org.
      if (existing.team?.organizationId !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Codex P1 round-9 finding (PR #336 audit harness): deletion was
      // unauthenticated beyond \`protectedProcedure\`. Inline membership
      // check (super-admin bypasses) so a team\'s template can only be
      // deleted by a member of that team.
      const userId = ctx.session.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const orgAdmin = await isOrgWideAdmin(userId, ctx.organizationId);
      if (!orgAdmin) {
        const membership = await prisma.teamMember.findUnique({
          where: { userId_teamId: { userId, teamId: existing.teamId } },
          select: { role: true },
        });
        // Require EDITOR+ to delete a team template, mirroring template.create's
        // withTeamAccess("EDITOR") gate. A VIEWER must not be able to delete.
        if (!membership || roleLevel[membership.role] < roleLevel.EDITOR) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }

      return prisma.template.delete({
        where: { id: input.id },
      });
    }),
});
