import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../../../_lib/api-handler";
import { rollback } from "@/server/services/pipeline-version";
import { relayPush } from "@/server/services/push-broadcast";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { fireEventAlert } from "@/server/services/event-alerts";

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

    // Notify connected agents and browsers about the rollback (non-fatal side effect)
    try {
      const pipelineDetails = await prisma.pipeline.findUnique({
        where: { id: pipeline.id },
        select: { name: true, environmentId: true, nodeSelector: true },
      });
      if (pipelineDetails) {
        const nodeSelector = pipelineDetails.nodeSelector as Record<string, string> | null;
        const targetNodes = await prisma.vectorNode.findMany({
          where: { environmentId: pipelineDetails.environmentId },
          select: { id: true, labels: true },
        });
        for (const node of targetNodes) {
          const labels = (node.labels as Record<string, string>) ?? {};
          const selectorEntries = Object.entries(nodeSelector ?? {});
          const matches = selectorEntries.every(([k, v]) => labels[k] === v);
          if (matches) {
            relayPush(node.id, {
              type: "config_changed",
              pipelineId: pipeline.id,
              reason: "rollback",
            });
          }
        }

        broadcastSSE({
          type: "status_change",
          nodeId: "",
          fromStatus: "",
          toStatus: "DEPLOYED",
          reason: "rollback",
          pipelineId: pipeline.id,
          pipelineName: pipelineDetails.name,
        }, pipelineDetails.environmentId);

        void fireEventAlert("deploy_completed", pipelineDetails.environmentId, {
          message: `Pipeline "${pipelineDetails.name}" rolled back via API`,
          pipelineId: pipeline.id,
        });
      }
    } catch (err) {
      console.error("[v1-rollback] Push/SSE notification failed:", err);
    }

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
