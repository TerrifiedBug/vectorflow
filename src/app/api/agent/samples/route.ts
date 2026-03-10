import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { z } from "zod";

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
      });
      if (!sampleRequest || sampleRequest.status !== "PENDING") {
        continue;
      }

      // Check if this component key already has a sample for this request
      // (multiple agents may submit results for the same pipeline — first one wins)
      const existing = await prisma.eventSample.findFirst({
        where: { requestId: result.requestId, componentKey: result.componentKey },
      });
      if (existing) {
        continue;
      }

      if (result.error) {
        await prisma.eventSampleRequest.update({
          where: { id: result.requestId },
          data: { status: "ERROR", completedAt: new Date(), nodeId: agent.nodeId },
        });
        await prisma.eventSample.create({
          data: {
            requestId: result.requestId,
            pipelineId: sampleRequest.pipelineId,
            componentKey: result.componentKey,
            events: [],
            schema: [],
            error: result.error,
          },
        });
      } else {
        await prisma.eventSample.create({
          data: {
            requestId: result.requestId,
            pipelineId: sampleRequest.pipelineId,
            componentKey: result.componentKey,
            events: result.events as object[],
            schema: result.schema,
          },
        });

        const componentKeys = sampleRequest.componentKeys as string[];
        const completedKeys = await prisma.eventSample.findMany({
          where: { requestId: result.requestId },
          select: { componentKey: true },
        });
        const completedKeySet = new Set(completedKeys.map((s) => s.componentKey));
        const allDone = componentKeys.every((k) => completedKeySet.has(k));

        if (allDone) {
          await prisma.eventSampleRequest.update({
            where: { id: result.requestId },
            data: { status: "COMPLETED", completedAt: new Date(), nodeId: agent.nodeId },
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Sample results error:", error);
    return NextResponse.json(
      { error: "Failed to process sample results" },
      { status: 500 },
    );
  }
}
