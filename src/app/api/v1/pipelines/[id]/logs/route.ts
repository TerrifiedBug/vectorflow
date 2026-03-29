import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";

export const GET = apiRoute(
  "metrics.read",
  async (req: NextRequest, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: { id: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const after = req.nextUrl.searchParams.get("after");
    const limitParam = req.nextUrl.searchParams.get("limit");
    const level = req.nextUrl.searchParams.get("level");
    const limit = Math.min(Math.max(parseInt(limitParam ?? "100", 10) || 100, 1), 500);

    const where: Record<string, unknown> = { pipelineId: id };
    if (level) {
      const validLevels = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];
      if (validLevels.includes(level.toUpperCase())) {
        where.level = level.toUpperCase();
      }
    }

    const logs = await prisma.pipelineLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: {
        id: true,
        pipelineId: true,
        nodeId: true,
        timestamp: true,
        level: true,
        message: true,
      },
    });

    let hasMore = false;
    if (logs.length > limit) {
      logs.pop();
      hasMore = true;
    }

    const cursor = logs.length > 0 ? logs[logs.length - 1].id : null;

    return NextResponse.json({ logs, cursor, hasMore });
  },
  "read",
);
