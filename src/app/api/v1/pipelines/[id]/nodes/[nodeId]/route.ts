import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { encryptNodeConfig } from "@/server/services/config-crypto";
import { apiRoute, jsonResponse } from "../../../../_lib/api-handler";

export const PUT = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx, params) => {
    const pipelineId = params?.id;
    const nodeId = params?.nodeId;
    if (!pipelineId || !nodeId) {
      return NextResponse.json({ error: "Missing pipeline or node id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId, environmentId: ctx.environmentId },
      select: { id: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const node = await prisma.pipelineNode.findFirst({
      where: { id: nodeId, pipelineId },
      select: { id: true, componentType: true },
    });
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    let body: {
      config?: Record<string, unknown>;
      displayName?: string;
      positionX?: number;
      positionY?: number;
      disabled?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (body.config !== undefined) {
      data.config = encryptNodeConfig(node.componentType, body.config);
    }
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.positionX !== undefined) data.positionX = body.positionX;
    if (body.positionY !== undefined) data.positionY = body.positionY;
    if (body.disabled !== undefined) data.disabled = body.disabled;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "At least one field to update is required" },
        { status: 400 },
      );
    }

    const updated = await prisma.pipelineNode.update({
      where: { id: nodeId },
      data,
    });

    writeAuditLog({
      action: "api.pipeline_node_updated",
      entityType: "PipelineNode",
      entityId: nodeId,
      userId: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { pipelineId, nodeId, updatedFields: Object.keys(data) },
    }).catch(() => {});

    return jsonResponse({ node: updated });
  },
);

export const DELETE = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx, params) => {
    const pipelineId = params?.id;
    const nodeId = params?.nodeId;
    if (!pipelineId || !nodeId) {
      return NextResponse.json({ error: "Missing pipeline or node id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId, environmentId: ctx.environmentId },
      select: { id: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const node = await prisma.pipelineNode.findFirst({
      where: { id: nodeId, pipelineId },
    });
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    // Remove connected edges first, then the node
    await prisma.pipelineEdge.deleteMany({
      where: {
        pipelineId,
        OR: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }],
      },
    });
    await prisma.pipelineNode.delete({ where: { id: nodeId } });

    writeAuditLog({
      action: "api.pipeline_node_removed",
      entityType: "PipelineNode",
      entityId: nodeId,
      userId: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { pipelineId, nodeId },
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
  },
);
