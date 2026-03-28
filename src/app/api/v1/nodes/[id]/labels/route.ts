import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../../../_lib/api-handler";

export const PUT = apiRoute(
  "nodes.manage",
  async (req: NextRequest, ctx, params) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing node id" }, { status: 400 });
    }

    const node = await prisma.vectorNode.findUnique({
      where: { id, environmentId: ctx.environmentId },
      select: { id: true },
    });
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    let body: { labels?: Record<string, string> };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.labels || typeof body.labels !== "object") {
      return NextResponse.json(
        { error: "labels object is required" },
        { status: 400 },
      );
    }

    const updated = await prisma.vectorNode.update({
      where: { id },
      data: { labels: body.labels },
      select: { id: true, name: true, labels: true },
    });

    return jsonResponse({ node: updated });
  },
);
