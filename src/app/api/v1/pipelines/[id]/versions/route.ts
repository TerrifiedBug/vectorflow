import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";

export const GET = apiRoute(
  "pipelines.read",
  async (_req, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Missing pipeline id" },
        { status: 400 },
      );
    }

    // Verify pipeline belongs to the service account's environment
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

    const versions = await prisma.pipelineVersion.findMany({
      where: { pipelineId: id },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        changelog: true,
        createdById: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ versions });
  },
);
