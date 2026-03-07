import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../../../_lib/api-handler";
import { rollback } from "@/server/services/pipeline-version";

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

    let body: { targetVersionId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.targetVersionId) {
      return NextResponse.json(
        { error: "targetVersionId is required" },
        { status: 400 },
      );
    }

    const version = await rollback(
      pipeline.id,
      body.targetVersionId,
      `sa:${ctx.serviceAccountId}`,
    );

    writeAuditLog({
      action: "api.pipeline_rolled_back",
      entityType: "Pipeline",
      entityId: pipeline.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { targetVersionId: body.targetVersionId, rolledBackToVersion: version.version },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      versionId: version.id,
      versionNumber: version.version,
    });
  },
);
