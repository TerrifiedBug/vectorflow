import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../../../_lib/api-handler";

export const GET = apiRoute(
  "metrics.read",
  async (_req, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: {
        id: true,
        name: true,
        isDraft: true,
        deployedAt: true,
      },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    // Fetch SLIs
    const slis = await prisma.pipelineSli.findMany({
      where: { pipelineId: id, enabled: true },
    });

    // Fetch node deployment statuses
    const nodeStatuses = await prisma.nodePipelineStatus.findMany({
      where: { pipelineId: id },
      select: {
        nodeId: true,
        status: true,
        version: true,
        eventsIn: true,
        eventsOut: true,
        errorsTotal: true,
      },
    });

    // Fetch latest aggregate metrics (last 5 minutes)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentMetrics = await prisma.pipelineMetric.findMany({
      where: {
        pipelineId: id,
        componentId: null, // aggregate rows only
        timestamp: { gte: fiveMinAgo },
      },
      orderBy: { timestamp: "desc" },
      take: 1,
    });

    const latestMetric = recentMetrics[0] ?? null;

    // Calculate overall health status
    const runningNodes = nodeStatuses.filter((ns) => ns.status === "RUNNING").length;
    const totalNodes = nodeStatuses.length;
    const hasErrors = latestMetric ? Number(latestMetric.errorsTotal) > 0 : false;

    let status: "healthy" | "degraded" | "unhealthy" | "unknown" = "unknown";
    if (pipeline.isDraft) {
      status = "unknown";
    } else if (totalNodes === 0) {
      status = "unknown";
    } else if (runningNodes === totalNodes && !hasErrors) {
      status = "healthy";
    } else if (runningNodes > 0) {
      status = "degraded";
    } else {
      status = "unhealthy";
    }

    return jsonResponse({
      health: {
        status,
        pipeline: {
          id: pipeline.id,
          name: pipeline.name,
          isDraft: pipeline.isDraft,
          deployedAt: pipeline.deployedAt,
        },
        nodes: {
          total: totalNodes,
          running: runningNodes,
          statuses: nodeStatuses,
        },
        slis,
        latestMetrics: latestMetric
          ? {
              eventsIn: Number(latestMetric.eventsIn),
              eventsOut: Number(latestMetric.eventsOut),
              errorsTotal: Number(latestMetric.errorsTotal),
              bytesIn: Number(latestMetric.bytesIn),
              bytesOut: Number(latestMetric.bytesOut),
              timestamp: latestMetric.timestamp,
            }
          : null,
      },
    });
  },
  "read",
);
