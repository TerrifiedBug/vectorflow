import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../../../_lib/api-handler";

export const POST = apiRoute(
  "deploy-requests.manage",
  async (req: NextRequest, ctx, params) => {
    const requestId = params?.id;
    if (!requestId) {
      return NextResponse.json({ error: "Missing request id" }, { status: 400 });
    }

    let body: { note?: string } = {};
    try {
      body = await req.json();
    } catch {
      // No body is OK for rejection
    }

    const request = await prisma.deployRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.environmentId !== ctx.environmentId) {
      return NextResponse.json(
        { error: "Deploy request not found" },
        { status: 404 },
      );
    }

    if (request.status !== "PENDING") {
      return NextResponse.json(
        { error: "Deploy request is not in PENDING state" },
        { status: 400 },
      );
    }

    const updated = await prisma.deployRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewedById: null,
        reviewNote: body.note ?? null,
        reviewedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { error: "Request is no longer pending" },
        { status: 409 },
      );
    }

    writeAuditLog({
      action: "api.deploy_request_rejected",
      entityType: "DeployRequest",
      entityId: requestId,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { pipelineId: request.pipelineId, note: body.note },
    }).catch(() => {});

    return NextResponse.json({ success: true, status: "REJECTED" });
  },
  "deploy",
);
