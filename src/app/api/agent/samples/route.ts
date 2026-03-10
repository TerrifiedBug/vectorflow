import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
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
      });
      if (!sampleRequest || sampleRequest.status !== "PENDING") {
        continue;
      }

      if (result.error) {
        await prisma.eventSampleRequest.update({
          where: { id: result.requestId },
          data: { status: "ERROR", completedAt: new Date(), nodeId: agent.nodeId },
        });
        try {
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
        } catch (err) {
          if (isUniqueViolation(err)) continue; // another agent already submitted
          throw err;
        }
      } else {
        try {
          await prisma.eventSample.create({
            data: {
              requestId: result.requestId,
              pipelineId: sampleRequest.pipelineId,
              componentKey: result.componentKey,
              events: result.events as object[],
              schema: result.schema,
            },
          });
        } catch (err) {
          if (isUniqueViolation(err)) continue; // another agent already submitted
          throw err;
        }

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
