import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../_lib/api-handler";

export const GET = apiRoute("alerts.read", async (_req, ctx) => {
  const rules = await prisma.alertRule.findMany({
    where: { environmentId: ctx.environmentId },
    include: {
      pipeline: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ rules });
});

export const POST = apiRoute(
  "alerts.manage",
  async (req: NextRequest, ctx) => {
    let body: {
      name?: string;
      pipelineId?: string;
      metric?: string;
      condition?: string;
      threshold?: number;
      durationSeconds?: number;
      teamId?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.name || !body.metric || !body.condition || body.threshold === undefined || !body.teamId) {
      return NextResponse.json(
        {
          error:
            "name, metric, condition, threshold, and teamId are required",
        },
        { status: 400 },
      );
    }

    const validMetrics = [
      "node_unreachable",
      "cpu_usage",
      "memory_usage",
      "disk_usage",
      "error_rate",
      "discarded_rate",
      "pipeline_crashed",
    ];
    const validConditions = ["gt", "lt", "eq"];

    if (!validMetrics.includes(body.metric)) {
      return NextResponse.json(
        { error: `Invalid metric. Must be one of: ${validMetrics.join(", ")}` },
        { status: 400 },
      );
    }

    if (!validConditions.includes(body.condition)) {
      return NextResponse.json(
        {
          error: `Invalid condition. Must be one of: ${validConditions.join(", ")}`,
        },
        { status: 400 },
      );
    }

    if (body.pipelineId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: body.pipelineId },
      });
      if (!pipeline || pipeline.environmentId !== ctx.environmentId) {
        return NextResponse.json(
          { error: "Pipeline not found in this environment" },
          { status: 404 },
        );
      }
    }

    const rule = await prisma.alertRule.create({
      data: {
        name: body.name,
        environmentId: ctx.environmentId,
        pipelineId: body.pipelineId,
        teamId: body.teamId,
        metric: body.metric as "cpu_usage",
        condition: body.condition as "gt",
        threshold: body.threshold,
        durationSeconds: body.durationSeconds ?? 60,
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  },
);
