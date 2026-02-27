import { z } from "zod";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

export const auditRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        action: z.string().optional(),
        userId: z.string().optional(),
        entityType: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const {
        action,
        userId,
        entityType,
        search,
        startDate,
        endDate,
        cursor,
      } = input;
      const take = 50;

      const where: Record<string, any> = {};

      if (action) {
        where.action = action;
      }

      if (userId) {
        where.userId = userId;
      }

      if (entityType) {
        where.entityType = entityType;
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      if (search) {
        where.OR = [
          { action: { contains: search, mode: "insensitive" } },
          { entityType: { contains: search, mode: "insensitive" } },
          { entityId: { contains: search, mode: "insensitive" } },
        ];
      }

      const items = await prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > take) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return {
        items,
        nextCursor,
      };
    }),

  /** Distinct action values for filter dropdown */
  actions: protectedProcedure.query(async () => {
    const results = await prisma.auditLog.findMany({
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    });
    return results.map((r) => r.action);
  }),

  /** Distinct entity type values for filter dropdown */
  entityTypes: protectedProcedure.query(async () => {
    const results = await prisma.auditLog.findMany({
      select: { entityType: true },
      distinct: ["entityType"],
      orderBy: { entityType: "asc" },
    });
    return results.map((r) => r.entityType);
  }),
});
