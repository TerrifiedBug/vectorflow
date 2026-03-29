import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../../../../_lib/api-handler";

export const DELETE = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx, params) => {
    const pipelineId = params?.id;
    const edgeId = params?.edgeId;
    if (!pipelineId || !edgeId) {
      return NextResponse.json({ error: "Missing pipeline or edge id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId, environmentId: ctx.environmentId },
      select: { id: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const edge = await prisma.pipelineEdge.findFirst({
      where: { id: edgeId, pipelineId },
    });
    if (!edge) {
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }

    await prisma.pipelineEdge.delete({ where: { id: edgeId } });

    writeAuditLog({
      action: "api.pipeline_edge_removed",
      entityType: "PipelineEdge",
      entityId: edgeId,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { pipelineId, edgeId },
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
  },
);
