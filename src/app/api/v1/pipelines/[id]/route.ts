import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../_lib/api-handler";

export const GET = apiRoute("pipelines.read", async (_req, ctx, params) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
  }

  const pipeline = await prisma.pipeline.findUnique({
    where: { id, environmentId: ctx.environmentId },
    include: {
      nodes: {
        select: {
          id: true,
          componentKey: true,
          componentType: true,
          kind: true,
          positionX: true,
          positionY: true,
          disabled: true,
        },
      },
      edges: {
        select: {
          id: true,
          sourceNodeId: true,
          targetNodeId: true,
          sourcePort: true,
        },
      },
      nodeStatuses: {
        select: {
          nodeId: true,
          status: true,
          version: true,
          eventsIn: true,
          eventsOut: true,
          errorsTotal: true,
        },
      },
    },
  });

  if (!pipeline) {
    return NextResponse.json(
      { error: "Pipeline not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ pipeline });
});
