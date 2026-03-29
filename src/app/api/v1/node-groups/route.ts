import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { apiRoute, jsonResponse } from "../_lib/api-handler";

export const GET = apiRoute(
  "node-groups.read",
  async (_req, ctx) => {
    const groups = await prisma.nodeGroup.findMany({
      where: { environmentId: ctx.environmentId },
      orderBy: { createdAt: "desc" },
    });

    return jsonResponse({ groups });
  },
  "read",
);

export const POST = apiRoute(
  "node-groups.manage",
  async (req: NextRequest, ctx) => {
    let body: {
      name?: string;
      criteria?: Record<string, unknown>;
      labelTemplate?: Record<string, string>;
      requiredLabels?: string[];
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }

    const group = await prisma.nodeGroup.create({
      data: {
        name: body.name.trim(),
        environmentId: ctx.environmentId,
        criteria: (body.criteria ?? {}) as Prisma.InputJsonValue,
        labelTemplate: body.labelTemplate ?? {},
        requiredLabels: body.requiredLabels ?? [],
      },
    });

    return jsonResponse({ group }, { status: 201 });
  },
);
