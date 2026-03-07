import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../_lib/api-handler";
import { encrypt } from "@/server/services/crypto";

export const GET = apiRoute("secrets.read", async (_req, ctx) => {
  const secrets = await prisma.secret.findMany({
    where: { environmentId: ctx.environmentId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ secrets });
});

export const POST = apiRoute(
  "secrets.manage",
  async (req: NextRequest, ctx) => {
    let body: { name?: string; value?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.name || !body.value) {
      return NextResponse.json(
        { error: "name and value are required" },
        { status: 400 },
      );
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(body.name)) {
      return NextResponse.json(
        {
          error:
            "Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores",
        },
        { status: 400 },
      );
    }

    const existing = await prisma.secret.findUnique({
      where: {
        environmentId_name: {
          environmentId: ctx.environmentId,
          name: body.name,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A secret with this name already exists" },
        { status: 409 },
      );
    }

    const secret = await prisma.secret.create({
      data: {
        name: body.name,
        encryptedValue: encrypt(body.value),
        environmentId: ctx.environmentId,
      },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    writeAuditLog({
      action: "api.secret_created",
      entityType: "Secret",
      entityId: secret.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { name: body.name },
    }).catch(() => {});

    return NextResponse.json({ secret }, { status: 201 });
  },
);

export const PUT = apiRoute(
  "secrets.manage",
  async (req: NextRequest, ctx) => {
    let body: { id?: string; name?: string; value?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.value) {
      return NextResponse.json(
        { error: "value is required" },
        { status: 400 },
      );
    }

    if (!body.id && !body.name) {
      return NextResponse.json(
        { error: "id or name is required" },
        { status: 400 },
      );
    }

    // Look up by id or name
    let secret;
    if (body.id) {
      secret = await prisma.secret.findUnique({ where: { id: body.id } });
    } else if (body.name) {
      secret = await prisma.secret.findUnique({
        where: {
          environmentId_name: {
            environmentId: ctx.environmentId,
            name: body.name,
          },
        },
      });
    }

    if (!secret || secret.environmentId !== ctx.environmentId) {
      return NextResponse.json(
        { error: "Secret not found" },
        { status: 404 },
      );
    }

    const updated = await prisma.secret.update({
      where: { id: secret.id },
      data: { encryptedValue: encrypt(body.value) },
      select: { id: true, name: true, updatedAt: true },
    });

    writeAuditLog({
      action: "api.secret_updated",
      entityType: "Secret",
      entityId: updated.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { name: updated.name },
    }).catch(() => {});

    return NextResponse.json({ secret: updated });
  },
);

export const DELETE = apiRoute(
  "secrets.manage",
  async (req: NextRequest, ctx) => {
    const id = req.nextUrl.searchParams.get("id");
    const name = req.nextUrl.searchParams.get("name");

    if (!id && !name) {
      return NextResponse.json(
        { error: "id or name query parameter is required" },
        { status: 400 },
      );
    }

    let secret;
    if (id) {
      secret = await prisma.secret.findUnique({ where: { id } });
    } else if (name) {
      secret = await prisma.secret.findUnique({
        where: {
          environmentId_name: {
            environmentId: ctx.environmentId,
            name,
          },
        },
      });
    }

    if (!secret || secret.environmentId !== ctx.environmentId) {
      return NextResponse.json(
        { error: "Secret not found" },
        { status: 404 },
      );
    }

    await prisma.secret.delete({ where: { id: secret.id } });

    writeAuditLog({
      action: "api.secret_deleted",
      entityType: "Secret",
      entityId: secret.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { name: secret.name },
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
  },
);
