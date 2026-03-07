import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../../_lib/api-handler";

export const GET = apiRoute("nodes.read", async (_req, ctx, params) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing node id" }, { status: 400 });
  }

  const node = await prisma.vectorNode.findUnique({
    where: { id, environmentId: ctx.environmentId },
    select: {
      id: true,
      name: true,
      host: true,
      apiPort: true,
      environmentId: true,
      status: true,
      lastSeen: true,
      lastHeartbeat: true,
      agentVersion: true,
      vectorVersion: true,
      os: true,
      deploymentMode: true,
      maintenanceMode: true,
      maintenanceModeAt: true,
      metadata: true,
      enrolledAt: true,
      createdAt: true,
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

  return jsonResponse({ node });
});
