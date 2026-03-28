import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../_lib/api-handler";

export const GET = apiRoute("pipelines.read", async (_req, ctx) => {
  const pipelines = await prisma.pipeline.findMany({
    where: { environmentId: ctx.environmentId },
    select: {
      id: true,
      name: true,
      description: true,
      isDraft: true,
      deployedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ pipelines });
}, "read");

export const POST = apiRoute(
  "pipelines.write",
  async (req: NextRequest, ctx) => {
    let body: { name?: string; description?: string; groupId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "name is required and must be a non-empty string" },
        { status: 400 },
      );
    }

    // Check for name collision within the environment
    const existing = await prisma.pipeline.findFirst({
      where: { name: body.name.trim(), environmentId: ctx.environmentId },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A pipeline named "${body.name.trim()}" already exists in this environment` },
        { status: 409 },
      );
    }

    // Resolve teamId from environment for audit purposes
    const env = await prisma.environment.findUnique({
      where: { id: ctx.environmentId },
      select: { teamId: true },
    });

    const pipeline = await prisma.pipeline.create({
      data: {
        name: body.name.trim(),
        description: body.description ?? null,
        environmentId: ctx.environmentId,
        groupId: body.groupId ?? null,
        isDraft: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        isDraft: true,
        deployedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    writeAuditLog({
      action: "api.pipeline_created",
      entityType: "Pipeline",
      entityId: pipeline.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: env?.teamId ?? null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { name: body.name.trim() },
    }).catch(() => {});

    return NextResponse.json({ pipeline }, { status: 201 });
  },
);
