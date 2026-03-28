import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../../../_lib/api-handler";

export const GET = apiRoute(
  "metrics.read",
  async (req: NextRequest, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing node id" }, { status: 400 });
    }

    const node = await prisma.vectorNode.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: { id: true },
    });
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    const since = req.nextUrl.searchParams.get("since");
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitParam ?? "100", 10) || 100, 1), 1000);

    const where: Record<string, unknown> = { nodeId: id };
    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return NextResponse.json({ error: "Invalid since parameter" }, { status: 400 });
      }
      where.timestamp = { gte: sinceDate };
    }

    const metrics = await prisma.nodeMetric.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return jsonResponse({ metrics });
  },
  "read",
);
