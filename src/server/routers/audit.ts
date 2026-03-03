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
        teamId: z.string().optional(),
        environmentId: z.string().optional(),
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

      const conditions: Record<string, unknown>[] = [];

      if (action) {
        conditions.push({ action });
      }

      if (userId) {
        conditions.push({ userId });
      }

      if (entityType) {
        conditions.push({ entityType });
      }

      if (input.teamId) {
        conditions.push({
          OR: [{ teamId: input.teamId }, { teamId: null }],
        });
      }

      if (input.environmentId) {
        conditions.push({ environmentId: input.environmentId });
      }

      if (startDate || endDate) {
        const createdAt: Record<string, Date> = {};
        if (startDate) {
          createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          createdAt.lte = new Date(endDate);
        }
        conditions.push({ createdAt });
      }

      if (search) {
        conditions.push({
          OR: [
            { action: { contains: search, mode: "insensitive" } },
            { entityType: { contains: search, mode: "insensitive" } },
            { entityId: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      const where = conditions.length > 0 ? { AND: conditions } : {};

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

  /** Distinct users who have audit log entries */
  users: protectedProcedure.query(async () => {
    const results = await prisma.auditLog.findMany({
      where: { userId: { not: null } },
      select: {
        user: { select: { id: true, name: true, email: true } },
      },
      distinct: ["userId"],
    });
    return results.map((r) => r.user).filter((u): u is NonNullable<typeof u> => u !== null);
  }),
});
