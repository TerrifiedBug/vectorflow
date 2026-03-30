import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";
import { resolveTeamForEnv } from "../../../_lib/resolve-team";
import { generatePipeline } from "@/server/services/migration/pipeline-generator";
import type { TranslationResult } from "@/server/services/migration/types";

export const POST = apiRoute(
  "migration.write",
  async (req: NextRequest, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    let body: { pipelineName?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.pipelineName) {
      return NextResponse.json(
        { error: "pipelineName is required" },
        { status: 400 },
      );
    }

    const teamId = await resolveTeamForEnv(ctx.environmentId);

    const project = await prisma.migrationProject.findUnique({
      where: { id },
    });

    if (!project || project.teamId !== teamId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!project.translatedBlocks) {
      return NextResponse.json(
        { error: "Run translate first" },
        { status: 400 },
      );
    }

    const translationResult = project.translatedBlocks as unknown as TranslationResult;

    const pipeline = await generatePipeline({
      translationResult,
      environmentId: ctx.environmentId,
      pipelineName: body.pipelineName,
      migrationProjectId: id,
    });

    await prisma.migrationProject.update({
      where: { id },
      data: {
        generatedPipelineId: pipeline.id,
        status: "COMPLETED",
      },
    });

    return NextResponse.json({ pipelineId: pipeline.id }, { status: 201 });
  },
);
