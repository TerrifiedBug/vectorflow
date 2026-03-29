import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute, jsonResponse } from "../../../_lib/api-handler";

export const POST = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx, params) => {
    const pipelineId = params?.id;
    if (!pipelineId) {
      return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId, environmentId: ctx.environmentId },
      select: { id: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    let body: { sourceNodeId?: string; targetNodeId?: string; sourcePort?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.sourceNodeId || !body.targetNodeId) {
      return NextResponse.json(
        { error: "sourceNodeId and targetNodeId are required" },
        { status: 400 },
      );
    }

    // Verify both nodes belong to this pipeline
    const sourceNode = await prisma.pipelineNode.findFirst({
      where: { id: body.sourceNodeId, pipelineId },
    });
    const targetNode = await prisma.pipelineNode.findFirst({
      where: { id: body.targetNodeId, pipelineId },
    });
    if (!sourceNode || !targetNode) {
      return NextResponse.json(
        { error: "Source or target node not found in this pipeline" },
        { status: 404 },
      );
    }

    const edge = await prisma.pipelineEdge.create({
      data: {
        pipelineId,
        sourceNodeId: body.sourceNodeId,
        targetNodeId: body.targetNodeId,
        sourcePort: body.sourcePort ?? null,
      },
    });

    writeAuditLog({
      action: "api.pipeline_edge_added",
      entityType: "PipelineEdge",
      entityId: edge.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { pipelineId, sourceNodeId: body.sourceNodeId, targetNodeId: body.targetNodeId },
    }).catch(() => {});

    return jsonResponse({ edge }, { status: 201 });
  },
);
