import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";
import { undeployAgent } from "@/server/services/deploy-agent";

export const POST = apiRoute(
  "pipelines.deploy",
  async (_req, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Missing pipeline id" },
        { status: 400 },
      );
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: { id: true },
    });

    if (!pipeline) {
      return NextResponse.json(
        { error: "Pipeline not found" },
        { status: 404 },
      );
    }

    const result = await undeployAgent(pipeline.id);

    return NextResponse.json({ success: result.success });
  },
);
