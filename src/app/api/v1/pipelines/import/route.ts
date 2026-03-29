import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importVectorConfig } from "@/lib/config-generator";
import { encryptNodeConfig } from "@/server/services/config-crypto";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute, jsonResponse } from "../../_lib/api-handler";
import type { ComponentKind, Prisma } from "@/generated/prisma";

export const POST = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx) => {
    let body: { name?: string; yaml?: string; description?: string; groupId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }

    if (!body.yaml || typeof body.yaml !== "string") {
      return NextResponse.json(
        { error: "yaml is required and must be a string" },
        { status: 400 },
      );
    }

    // Check name collision
    const existing = await prisma.pipeline.findFirst({
      where: { name: body.name.trim(), environmentId: ctx.environmentId },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A pipeline named "${body.name.trim()}" already exists in this environment` },
        { status: 409 },
      );
    }

    let importResult;
    try {
      importResult = importVectorConfig(body.yaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse YAML";
      return NextResponse.json(
        { error: `Invalid YAML config: ${message}` },
        { status: 400 },
      );
    }

    const env = await prisma.environment.findUnique({
      where: { id: ctx.environmentId },
      select: { teamId: true },
    });

    const pipeline = await prisma.$transaction(async (tx) => {
      const created = await tx.pipeline.create({
        data: {
          name: body.name!.trim(),
          description: body.description ?? null,
          environmentId: ctx.environmentId,
          groupId: body.groupId ?? null,
          globalConfig: importResult.globalConfig
            ? (importResult.globalConfig as unknown as Prisma.InputJsonValue)
            : undefined,
          isDraft: true,
        },
      });

      // Create nodes
      for (const node of importResult.nodes) {
        const nodeData = node.data as {
          componentKey: string;
          componentDef: { type: string; kind: string };
          config: Record<string, unknown>;
          disabled?: boolean;
        };

        const kind = nodeData.componentDef.kind.toUpperCase() as ComponentKind;

        await tx.pipelineNode.create({
          data: {
            id: node.id,
            pipelineId: created.id,
            componentKey: nodeData.componentKey,
            componentType: nodeData.componentDef.type,
            kind,
            config: encryptNodeConfig(
              nodeData.componentDef.type,
              nodeData.config ?? {},
            ) as unknown as Prisma.InputJsonValue,
            positionX: node.position?.x ?? 0,
            positionY: node.position?.y ?? 0,
            disabled: nodeData.disabled ?? false,
          },
        });
      }

      // Create edges
      for (const edge of importResult.edges) {
        await tx.pipelineEdge.create({
          data: {
            id: edge.id,
            pipelineId: created.id,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            sourcePort: (edge as { sourceHandle?: string }).sourceHandle ?? null,
          },
        });
      }

      return created;
    });

    writeAuditLog({
      action: "api.pipeline_imported",
      entityType: "Pipeline",
      entityId: pipeline.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: env?.teamId ?? null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: {
        name: body.name,
        nodeCount: importResult.nodes.length,
        edgeCount: importResult.edges.length,
      },
    }).catch(() => {});

    return jsonResponse(
      {
        pipeline: {
          id: pipeline.id,
          name: pipeline.name,
          nodeCount: importResult.nodes.length,
          edgeCount: importResult.edges.length,
        },
      },
      { status: 201 },
    );
  },
);
