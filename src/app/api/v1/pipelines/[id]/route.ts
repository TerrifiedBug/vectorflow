import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute, jsonResponse } from "../../_lib/api-handler";

export const GET = apiRoute("pipelines.read", async (_req, ctx, params) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
  }

  const pipeline = await prisma.pipeline.findUnique({
    where: { id, environmentId: ctx.environmentId },
    select: {
      id: true,
      name: true,
      description: true,
      isDraft: true,
      deployedAt: true,
      environmentId: true,
      createdAt: true,
      updatedAt: true,
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

  return jsonResponse({ pipeline });
});

export const PUT = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
    }

    const existing = await prisma.pipeline.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: { id: true, environmentId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    let body: { name?: string; description?: string; groupId?: string | null };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.groupId !== undefined) data.groupId = body.groupId;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "At least one field (name, description, groupId) is required" },
        { status: 400 },
      );
    }

    const pipeline = await prisma.pipeline.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        description: true,
        isDraft: true,
        deployedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    writeAuditLog({
      action: "api.pipeline_updated",
      entityType: "Pipeline",
      entityId: pipeline.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: data,
    }).catch(() => {});

    return jsonResponse({ pipeline });
  },
);

export const DELETE = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: { id: true, name: true, isDraft: true, deployedAt: true },
    });

    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    if (!pipeline.isDraft) {
      return NextResponse.json(
        { error: "Cannot delete a deployed pipeline. Undeploy it first." },
        { status: 409 },
      );
    }

    await prisma.pipeline.delete({ where: { id } });

    writeAuditLog({
      action: "api.pipeline_deleted",
      entityType: "Pipeline",
      entityId: pipeline.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { name: pipeline.name },
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
  },
);
