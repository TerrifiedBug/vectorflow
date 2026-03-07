import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";
import { deployAgent } from "@/server/services/deploy-agent";

export const POST = apiRoute(
  "pipelines.deploy",
  async (req, ctx, params) => {
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

    let changelog = "Deployed via REST API";
    try {
      const body = await req.json();
      if (body.changelog && typeof body.changelog === "string") {
        changelog = body.changelog;
      }
    } catch {
      // No body or invalid JSON — use default changelog
    }

    const result = await deployAgent(
      pipeline.id,
      ctx.serviceAccountId,
      changelog,
    );

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Deployment failed",
          validationErrors: result.validationErrors,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
    });
  },
);
