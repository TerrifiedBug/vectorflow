import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireRole } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { BUILTIN_TEMPLATES } from "@/lib/vector/builtin-templates";

const templateNodeSchema = z.object({
  id: z.string(),
  componentType: z.string(),
  componentKey: z.string(),
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
  /** List all templates: built-in + team's custom templates */
  list: protectedProcedure
    .input(z.object({ teamId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const builtins = BUILTIN_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        isBuiltin: true as const,
        nodeCount: t.nodes.length,
        edgeCount: t.edges.length,
        createdAt: null as Date | null,
      }));

      let custom: Array<{
        id: string;
        name: string;
        description: string;
        category: string;
        isBuiltin: false;
        nodeCount: number;
        edgeCount: number;
        createdAt: Date | null;
      }> = [];

      if (input?.teamId) {
        const dbTemplates = await prisma.template.findMany({
          where: { teamId: input.teamId },
          orderBy: { createdAt: "desc" },
        });

        custom = dbTemplates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          isBuiltin: false as const,
          nodeCount: Array.isArray(t.nodes) ? (t.nodes as unknown[]).length : 0,
          edgeCount: Array.isArray(t.edges) ? (t.edges as unknown[]).length : 0,
          createdAt: t.createdAt,
        }));
      }

      return [...builtins, ...custom];
    }),

  /** List only built-in templates */
  builtins: protectedProcedure.query(() => {
    return BUILTIN_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      nodeCount: t.nodes.length,
      edgeCount: t.edges.length,
    }));
  }),

  /** Get a single template by ID (built-in or custom) */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      // Check built-ins first
      const builtin = BUILTIN_TEMPLATES.find((t) => t.id === input.id);
      if (builtin) {
        return {
          id: builtin.id,
          name: builtin.name,
          description: builtin.description,
          category: builtin.category,
          isBuiltin: true,
          nodes: builtin.nodes,
          edges: builtin.edges,
        };
      }

      // Check custom templates
      const custom = await prisma.template.findUnique({
        where: { id: input.id },
      });
      if (!custom) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      return {
        id: custom.id,
        name: custom.name,
        description: custom.description,
        category: custom.category,
        isBuiltin: false,
        nodes: custom.nodes as unknown[],
        edges: custom.edges as unknown[],
      };
    }),

  /** Create a custom template (EDITOR+ role) */
  create: protectedProcedure
    .use(requireRole("EDITOR"))
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
          nodes: input.nodes as any,
          edges: input.edges as any,
        },
      });
    }),

  /** Delete a custom template */
  delete: protectedProcedure
    .use(requireRole("EDITOR"))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      // Don't allow deleting built-in templates
      const isBuiltin = BUILTIN_TEMPLATES.some((t) => t.id === input.id);
      if (isBuiltin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete built-in templates",
        });
      }

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
