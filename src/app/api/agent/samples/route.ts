import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { z } from "zod";
import { errorLog } from "@/lib/logger";

const sampleResultSchema = z.object({
  results: z.array(
    z.object({
      requestId: z.string(),
      componentKey: z.string(),
      events: z.array(z.unknown()).optional().default([]),
      schema: z
        .array(
          z.object({
            path: z.string(),
            type: z.string(),
            sample: z.string(),
          }),
        )
        .optional()
        .default([]),
      error: z.string().optional(),
    }),
  ),
});

/** Returns true if this is a Prisma unique constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function POST(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = sampleResultSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { results } = parsed.data;

    for (const result of results) {
      const sampleRequest = await prisma.eventSampleRequest.findUnique({
        where: { id: result.requestId },
        include: { pipeline: { select: { environmentId: true } } },
      });
      if (!sampleRequest || sampleRequest.status !== "PENDING") {
        continue;
      }

      // Verify the request's pipeline belongs to this agent's environment
      if (sampleRequest.pipeline.environmentId !== agent.environmentId) {
        continue;
      }

      // Write the EventSample (success or error)
      try {
        await prisma.eventSample.create({
          data: {
            requestId: result.requestId,
            pipelineId: sampleRequest.pipelineId,
            componentKey: result.componentKey,
            events: result.error ? [] : (result.events as object[]),
            schema: result.error ? [] : result.schema,
            error: result.error ?? null,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue; // another agent already submitted
        throw err;
      }

      // Check if all components now have samples (success or error)
      const componentKeys = sampleRequest.componentKeys as string[];
      const samples = await prisma.eventSample.findMany({
        where: { requestId: result.requestId },
        select: { componentKey: true, error: true },
      });
      const sampledKeySet = new Set(samples.map((s) => s.componentKey));
      const allDone = componentKeys.every((k) => sampledKeySet.has(k));

      if (allDone) {
        const hasErrors = samples.some((s) => s.error != null);
        // Atomically transition PENDING → final status; no-op if already moved.
        await prisma.eventSampleRequest.updateMany({
          where: { id: result.requestId, status: "PENDING" },
          data: {
            status: hasErrors ? "ERROR" : "COMPLETED",
            completedAt: new Date(),
            nodeId: agent.nodeId,
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    errorLog("agent-samples", "Sample results error", error);
    return NextResponse.json(
      { error: "Failed to process sample results" },
      { status: 500 },
    );
  }
}
