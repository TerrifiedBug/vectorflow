import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../_lib/api-handler";
import { writeAuditLog } from "@/server/services/audit";

export const GET = apiRoute("migration.read", async (_req, ctx) => {
  const projects = await prisma.migrationProject.findMany({
    where: {
      team: {
        environments: {
          some: { id: ctx.environmentId },
        },
      },
    },
    select: {
      id: true,
      name: true,
      platform: true,
      status: true,
      readinessScore: true,
      generatedPipelineId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ projects });
}, "read");

export const POST = apiRoute(
  "migration.write",
  async (req: NextRequest, ctx) => {
    let body: { name?: string; platform?: string; originalConfig?: string };
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
        { error: "name is required" },
        { status: 400 },
      );
    }

    if (body.platform !== "FLUENTD") {
      return NextResponse.json(
        { error: "platform must be 'FLUENTD'" },
        { status: 400 },
      );
    }

    if (!body.originalConfig || typeof body.originalConfig !== "string") {
      return NextResponse.json(
        { error: "originalConfig is required" },
        { status: 400 },
      );
    }

    // Resolve teamId from environment
    const env = await prisma.environment.findUnique({
      where: { id: ctx.environmentId },
      select: { teamId: true },
    });

    if (!env?.teamId) {
      return NextResponse.json(
        { error: "Could not resolve team from environment" },
        { status: 400 },
      );
    }

    const project = await prisma.migrationProject.create({
      data: {
        name: body.name.trim(),
        teamId: env.teamId,
        platform: "FLUENTD",
        originalConfig: body.originalConfig,
        status: "DRAFT",
        createdById: ctx.serviceAccountId, // service account as creator
      },
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        createdAt: true,
      },
    });

    writeAuditLog({
      action: "api.migration_created",
      entityType: "MigrationProject",
      entityId: project.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: env.teamId,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { name: body.name.trim(), platform: "FLUENTD" },
    }).catch(() => {});

    return NextResponse.json({ project }, { status: 201 });
  },
);
