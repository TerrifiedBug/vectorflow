import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../../../_lib/api-handler";

export const POST = apiRoute(
  "nodes.manage",
  async (req, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Missing node id" },
        { status: 400 },
      );
    }

    const node = await prisma.vectorNode.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: { id: true },
    });

    if (!node) {
      return NextResponse.json(
        { error: "Node not found" },
        { status: 404 },
      );
    }

    let body: { enabled?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled (boolean) is required" },
        { status: 400 },
      );
    }

    const updated = await prisma.vectorNode.update({
      where: { id },
      data: {
        maintenanceMode: body.enabled,
        maintenanceModeAt: body.enabled ? new Date() : null,
      },
      select: {
        id: true,
        name: true,
        maintenanceMode: true,
        maintenanceModeAt: true,
      },
    });

    writeAuditLog({
      action: "api.node_maintenance_toggled",
      entityType: "VectorNode",
      entityId: updated.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { nodeName: updated.name, maintenanceMode: updated.maintenanceMode },
    }).catch(() => {});

    return NextResponse.json({ node: updated });
  },
);
