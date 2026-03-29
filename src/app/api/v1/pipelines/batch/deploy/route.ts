import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../../../_lib/api-handler";
import { deployBatch } from "@/server/services/deploy-agent";

const bodySchema = z.object({
  pipelineIds: z
    .array(z.string().min(1))
    .min(1, "At least one pipeline ID is required")
    .max(200, "Maximum 200 pipelines per batch"),
  changelog: z.string().min(1).default("Deployed via REST API batch"),
});

export const POST = apiRoute(
  "pipelines.deploy",
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { pipelineIds, changelog } = parsed.data;

    const result = await deployBatch(
      pipelineIds,
      `sa:${ctx.serviceAccountId}`,
      changelog,
    );

    writeAuditLog({
      action: "api.pipeline_batch_deployed",
      entityType: "Pipeline",
      entityId: pipelineIds.join(","),
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: {
        pipelineCount: pipelineIds.length,
        completed: result.completed,
        failed: result.failed,
        changelog,
      },
    }).catch(() => {});

    return NextResponse.json(result);
  },
);
