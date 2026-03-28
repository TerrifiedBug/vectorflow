import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { encryptNodeConfig } from "@/server/services/config-crypto";
import { apiRoute, jsonResponse } from "../../../_lib/api-handler";
import type { ComponentKind } from "@/generated/prisma";

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

    let body: {
      componentKey?: string;
      displayName?: string;
      componentType?: string;
      kind?: string;
      config?: Record<string, unknown>;
      positionX?: number;
      positionY?: number;
      disabled?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.componentKey || !body.componentType || !body.kind) {
      return NextResponse.json(
        { error: "componentKey, componentType, and kind are required" },
        { status: 400 },
      );
    }

    const validKinds = ["SOURCE", "TRANSFORM", "SINK"];
    const normalizedKind = body.kind.toUpperCase();
    if (!validKinds.includes(normalizedKind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${validKinds.join(", ")}` },
        { status: 400 },
      );
    }

    const encryptedConfig = encryptNodeConfig(
      body.componentType,
      body.config ?? {},
    );

    const node = await prisma.pipelineNode.create({
      data: {
        pipelineId,
        componentKey: body.componentKey,
        displayName: body.displayName ?? null,
        componentType: body.componentType,
        kind: normalizedKind as ComponentKind,
        config: encryptedConfig,
        positionX: body.positionX ?? 0,
        positionY: body.positionY ?? 0,
        disabled: body.disabled ?? false,
      },
    });

    writeAuditLog({
      action: "api.pipeline_node_added",
      entityType: "PipelineNode",
      entityId: node.id,
      userId: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { pipelineId, componentKey: body.componentKey, kind: normalizedKind },
    }).catch(() => {});

    return jsonResponse({ node }, { status: 201 });
  },
);
