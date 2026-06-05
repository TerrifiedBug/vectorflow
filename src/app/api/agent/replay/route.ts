import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import { authenticateAgentInOrg } from "@/server/services/agent-auth";
import { resolveAgentOrg } from "@/server/services/agent-org-binding";
import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { errorLog } from "@/lib/logger";
import { isLakeEnabled } from "@/server/services/lake/clickhouse";
import { nextReplayBatch } from "@/server/services/lake/replay";

/**
 * Agent replay-batch pull endpoint (A4) — the re-injection transport.
 *
 * An agent running a target pipeline polls this endpoint to drain a replay
 * job: each call advances the job cursor and returns the next bounded window of
 * lake events as NDJSON (one JSON event per line), each stamped with the job's
 * `replayDedupeKey`/`replayJobId` so a downstream sink can dedupe a re-run.
 *
 * Vector integration (agent-side, no Go changes here): configure an
 * `http_client` source with `method = "POST"`, the endpoint
 * `…/api/agent/replay?pipelineId=<this pipeline>`, the agent bearer token, and
 * `decoding.codec = "json"` with newline framing. The source feeds the replayed
 * events back into the pipeline graph like any other input.
 *
 * Responses:
 *   - 200 `application/x-ndjson` — a batch of events (job still running or just
 *     completed). Job metadata travels in `X-VF-Replay-*` headers.
 *   - 204 — no events to serve: either no active job, or the job drained this
 *     pull (then `X-VF-Replay-Status: COMPLETED`). The agent stops polling.
 */
export async function POST(request: Request) {
  const rateLimited = await checkTokenRateLimit(request, "agent-replay", 120);
  if (rateLimited) return rateLimited;

  const orgResult = await resolveAgentOrg(request);
  if (orgResult instanceof Response) return orgResult;

  const agent = await authenticateAgentInOrg(request, orgResult.orgId);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Inert on non-lake deployments — there is nothing to replay.
  if (!isLakeEnabled()) {
    return new NextResponse(null, { status: 204 });
  }

  const url = new URL(request.url);
  const pipelineId = url.searchParams.get("pipelineId");
  if (!pipelineId) {
    return NextResponse.json(
      { error: "pipelineId query parameter is required" },
      { status: 400 },
    );
  }
  const batchSizeParam = url.searchParams.get("batchSize");
  const batchSize = batchSizeParam ? Number(batchSizeParam) : undefined;

  return runWithOrgContext(orgResult.orgId, async () => {
    try {
      // The agent may only pull replays for a pipeline in its OWN environment —
      // a token bound to env X cannot drain a job targeting a pipeline in env Y.
      const pipeline = await prisma.pipeline.findFirst({
        where: {
          id: pipelineId,
          organizationId: orgResult.orgId,
          environmentId: agent.environmentId,
        },
        select: { id: true },
      });
      if (!pipeline) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const batch = await nextReplayBatch({
        orgId: orgResult.orgId,
        targetPipelineId: pipelineId,
        batchSize,
      });

      // No active (PENDING|RUNNING) job for this pipeline.
      if (!batch) {
        return new NextResponse(null, { status: 204 });
      }

      const headers = new Headers({
        "X-VF-Replay-Job-Id": batch.jobId,
        "X-VF-Replay-Dedupe-Key": batch.dedupeKey,
        "X-VF-Replay-Status": batch.status,
        "X-VF-Replay-Replayed": String(batch.replayedEvents),
        "X-VF-Replay-Total": String(batch.totalEvents),
        "X-VF-Replay-Done": String(batch.done),
      });

      // Job found but nothing to serve this pull (drained / empty window): 204
      // with the status headers so the agent can observe COMPLETED and stop.
      if (batch.events.length === 0) {
        return new NextResponse(null, { status: 204, headers });
      }

      headers.set("Content-Type", "application/x-ndjson");
      const body = batch.events.map((event) => JSON.stringify(event)).join("\n") + "\n";
      return new NextResponse(body, { status: 200, headers });
    } catch (error) {
      errorLog("agent-replay", "Replay batch endpoint error", error);
      return NextResponse.json({ error: "Failed to serve replay batch" }, { status: 500 });
    }
  });
}
