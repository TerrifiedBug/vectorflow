import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../_lib/api-handler";

export const GET = apiRoute("nodes.read", async (_req, ctx, params) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing node id" }, { status: 400 });
  }

  const node = await prisma.vectorNode.findUnique({
    where: { id, environmentId: ctx.environmentId },
    include: {
      environment: { select: { id: true, name: true } },
      pipelineStatuses: {
        include: {
          pipeline: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  return NextResponse.json({ node });
});
