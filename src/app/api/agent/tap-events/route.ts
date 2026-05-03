import { NextResponse } from "next/server";
import { z } from "zod";
import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { authenticateAgent } from "@/server/services/agent-auth";
import { getActiveTap } from "@/server/services/active-taps";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { errorLog } from "@/lib/logger";
import type { TapEventSSE, TapStoppedSSE } from "@/lib/sse/types";

const tapPayloadSchema = z.object({
  requestId: z.string(),
  pipelineId: z.string(),
  componentId: z.string(),
  events: z.array(z.unknown()).optional(),
  status: z.enum(["stopped"]).optional(),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  const rateLimited = checkTokenRateLimit(request, "agent-tap-events", 120);
  if (rateLimited) return rateLimited;

  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = tapPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { requestId, pipelineId, componentId, events, status, reason } =
      parsed.data;

    const tap = await getActiveTap(requestId);
    if (
      !tap ||
      tap.nodeId !== agent.nodeId ||
      tap.pipelineId !== pipelineId ||
      tap.componentId !== componentId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (status === "stopped") {
      const event: TapStoppedSSE = {
        type: "tap_stopped",
        requestId,
        reason: reason ?? "unknown",
      };
      broadcastSSE(event, agent.environmentId);
    } else if (events && events.length > 0) {
      const event: TapEventSSE = {
        type: "tap_event",
        requestId,
        pipelineId,
        componentId,
        events,
      };
      broadcastSSE(event, agent.environmentId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    errorLog("agent-tap-events", "Tap events endpoint error", error);
    return NextResponse.json(
      { error: "Failed to process tap events" },
      { status: 500 },
    );
  }
}
