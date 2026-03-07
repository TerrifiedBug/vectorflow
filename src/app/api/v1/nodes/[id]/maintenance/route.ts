import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

    return NextResponse.json({ node: updated });
  },
);
