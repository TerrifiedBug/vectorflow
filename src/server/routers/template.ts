import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";

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
        where: { teamId: input.teamId },
        orderBy: { createdAt: "desc" },
      });
      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        nodeCount: Array.isArray(t.nodes) ? (t.nodes as unknown[]).length : 0,
        edgeCount: Array.isArray(t.edges) ? (t.edges as unknown[]).length : 0,
        createdAt: t.createdAt,
      }));
    }),

  /** Get a single template by ID */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const template = await prisma.template.findUnique({
        where: { id: input.id },
      });
      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
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
    .mutation(async ({ input }) => {
      const existing = await prisma.template.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      return prisma.template.delete({
        where: { id: input.id },
      });
    }),
});
