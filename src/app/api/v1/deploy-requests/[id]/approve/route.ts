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

    // Atomically claim the request
    const updated = await prisma.deployRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: {
        status: "APPROVED",
        reviewedById: null,
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
      action: "api.deploy_request_approved",
      entityType: "DeployRequest",
      entityId: requestId,
      userId: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { pipelineId: request.pipelineId },
    }).catch(() => {});

    return NextResponse.json({ success: true, status: "APPROVED" });
  },
  "deploy",
);
