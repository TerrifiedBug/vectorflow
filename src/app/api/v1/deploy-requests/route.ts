import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../_lib/api-handler";

export const GET = apiRoute(
  "deploy-requests.manage",
  async (req: NextRequest, ctx) => {
    const status = req.nextUrl.searchParams.get("status");
    const pipelineId = req.nextUrl.searchParams.get("pipelineId");

    const where: Record<string, unknown> = {
      environmentId: ctx.environmentId,
    };

    if (status) {
      const validStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "DEPLOYED"];
      if (validStatuses.includes(status.toUpperCase())) {
        where.status = status.toUpperCase();
      }
    }

    if (pipelineId) {
      where.pipelineId = pipelineId;
    }

    const requests = await prisma.deployRequest.findMany({
      where,
      select: {
        id: true,
        pipelineId: true,
        environmentId: true,
        status: true,
        changelog: true,
        createdAt: true,
        reviewedAt: true,
        reviewNote: true,
        deployedAt: true,
        pipeline: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return jsonResponse({ requests });
  },
  "read",
);
