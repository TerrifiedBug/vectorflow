import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../_lib/api-handler";

export const GET = apiRoute("audit.read", async (req: NextRequest, ctx) => {
  const after = req.nextUrl.searchParams.get("after");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const action = req.nextUrl.searchParams.get("action");

  const limit = Math.min(Math.max(parseInt(limitParam ?? "50", 10) || 50, 1), 200);

  if (after) {
    const exists = await prisma.auditLog.findUnique({ where: { id: after }, select: { id: true } });
    if (!exists) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }

  const conditions: Record<string, unknown>[] = [
    { environmentId: ctx.environmentId },
  ];

  if (action) {
    conditions.push({ action });
  }

  const where = { AND: conditions };

  const events = await prisma.auditLog.findMany({
    where,
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });

  let hasMore = false;
  if (events.length > limit) {
    events.pop();
    hasMore = true;
  }

  const cursor = events.length > 0 ? events[events.length - 1].id : null;

  return NextResponse.json({ events, cursor, hasMore });
});
