import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVectorYaml } from "@/lib/config-generator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { apiRoute } from "../../../_lib/api-handler";

export const GET = apiRoute(
  "pipelines.read",
  async (_req, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id, environmentId: ctx.environmentId },
      include: {
        nodes: true,
        edges: true,
        environment: { select: { name: true } },
      },
    });

    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const flowNodes = pipeline.nodes.map((n) => ({
      id: n.id,
      type: n.kind.toLowerCase(),
      position: { x: n.positionX, y: n.positionY },
      data: {
        componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
        componentKey: n.componentKey,
        config: decryptNodeConfig(
          n.componentType,
          (n.config as Record<string, unknown>) ?? {},
        ),
        disabled: n.disabled,
      },
    }));

    const flowEdges = pipeline.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
    }));

    const yaml = generateVectorYaml(
      flowNodes as Parameters<typeof generateVectorYaml>[0],
      flowEdges as Parameters<typeof generateVectorYaml>[1],
      pipeline.globalConfig as Record<string, unknown> | null,
    );

    return NextResponse.json({ config: yaml, format: "yaml" });
  },
  "read",
);
