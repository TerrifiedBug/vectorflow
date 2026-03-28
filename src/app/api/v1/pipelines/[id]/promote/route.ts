import { NextRequest, NextResponse } from "next/server";
import { promotePipeline } from "@/server/services/pipeline-graph";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute, jsonResponse } from "../../../_lib/api-handler";

export const POST = apiRoute(
  "pipelines.promote",
  async (req: NextRequest, ctx, params) => {
    const pipelineId = params?.id;
    if (!pipelineId) {
      return NextResponse.json({ error: "Missing pipeline id" }, { status: 400 });
    }

    let body: { targetEnvironmentId?: string; name?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.targetEnvironmentId) {
      return NextResponse.json(
        { error: "targetEnvironmentId is required" },
        { status: 400 },
      );
    }

    const result = await promotePipeline({
      sourcePipelineId: pipelineId,
      targetEnvironmentId: body.targetEnvironmentId,
      name: body.name,
      userId: `sa:${ctx.serviceAccountId}`,
    });

    writeAuditLog({
      action: "api.pipeline_promoted",
      entityType: "Pipeline",
      entityId: pipelineId,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: {
        targetEnvironmentId: body.targetEnvironmentId,
        newPipelineId: result.id,
      },
    }).catch(() => {});

    return jsonResponse(
      {
        promoted: {
          pipelineId: result.id,
          name: result.name,
          targetEnvironmentName: result.targetEnvironmentName,
          strippedSecrets: result.strippedSecrets,
          strippedCertificates: result.strippedCertificates,
        },
      },
      { status: 201 },
    );
  },
  "deploy",
);
