import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../../../_lib/api-handler";

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

    const since = req.nextUrl.searchParams.get("since");
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitParam ?? "100", 10) || 100, 1), 1000);

    const where: Record<string, unknown> = { pipelineId: id };
    if (since) {
      where.timestamp = { gte: new Date(since) };
    }

    const metrics = await prisma.pipelineMetric.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return jsonResponse({ metrics });
  },
  "read",
);
