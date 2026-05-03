import { NextResponse } from "next/server";
import { z } from "zod";
import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { ingestLogs } from "@/server/services/log-ingest";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { errorLog } from "@/lib/logger";
import type { LogEntryEvent } from "@/lib/sse/types";

const logBatchSchema = z.array(
  z.object({
    pipelineId: z.string(),
    lines: z.array(z.string()).max(500),
  }),
);

export async function POST(request: Request) {
  const rateLimited = checkTokenRateLimit(request, "agent-logs", 60);
  if (rateLimited) return rateLimited;

  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = logBatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const requestedPipelineIds = [
      ...new Set(parsed.data.map((batch) => batch.pipelineId)),
    ];
    if (requestedPipelineIds.length > 0) {
      const pipelines = await prisma.pipeline.findMany({
        where: {
          id: { in: requestedPipelineIds },
          environmentId: agent.environmentId,
        },
        select: { id: true },
      });
      const allowedPipelineIds = new Set(pipelines.map((pipeline) => pipeline.id));
      if (
        pipelines.length !== requestedPipelineIds.length ||
        requestedPipelineIds.some((pipelineId) => !allowedPipelineIds.has(pipelineId))
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    for (const batch of parsed.data) {
      if (batch.lines.length === 0) continue;

      ingestLogs(
        agent.nodeId,
        batch.pipelineId,
        agent.environmentId,
        batch.lines,
      ).catch((err) =>
        errorLog("agent-logs", "Log ingestion failed", err),
      );

      const event: LogEntryEvent = {
        type: "log_entry",
        nodeId: agent.nodeId,
        pipelineId: batch.pipelineId,
        lines: batch.lines,
      };
      broadcastSSE(event, agent.environmentId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    errorLog("agent-logs", "Log endpoint error", error);
    return NextResponse.json(
      { error: "Failed to process logs" },
      { status: 500 },
    );
  }
}
