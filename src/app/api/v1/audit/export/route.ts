import { NextRequest, NextResponse } from "next/server";
import { apiRoute, jsonResponse } from "@/app/api/v1/_lib/api-handler";
import { prisma } from "@/lib/prisma";
import { formatAuditCsv } from "@/server/services/audit-export";

export const GET = apiRoute(
  "audit.export",
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);

    const format = searchParams.get("format") ?? "csv";
    if (format !== "csv" && format !== "json") {
      return NextResponse.json(
        { error: 'Invalid format — must be "csv" or "json"' },
        { status: 400 },
      );
    }

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const action = searchParams.get("action");
    const entityType = searchParams.get("entityType");
    const userId = searchParams.get("userId");
    const limitParam = searchParams.get("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam ?? "10000", 10) || 10000, 1),
      10000,
    );

    // Build query conditions — scope to the service account's environment
    const conditions: Record<string, unknown>[] = [
      { environmentId: ctx.environmentId },
    ];

    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) createdAt.gte = new Date(from);
      if (to) createdAt.lte = new Date(to);
      conditions.push({ createdAt });
    }

    if (action) {
      conditions.push({ action });
    }

    if (entityType) {
      conditions.push({ entityType });
    }

    if (userId) {
      conditions.push({ userId });
    }

    const where = { AND: conditions };

    const items = await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    if (format === "json") {
      return jsonResponse(
        items.map((item) => ({
          id: item.id,
          timestamp: item.createdAt.toISOString(),
          user: item.user?.name ?? null,
          email: item.user?.email ?? null,
          action: item.action,
          entityType: item.entityType,
          entityId: item.entityId,
          teamId: item.teamId,
          environmentId: item.environmentId,
          ipAddress: item.ipAddress,
          metadata: item.metadata ?? null,
        })),
      );
    }

    const csv = formatAuditCsv(items);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  },
  "deploy",
);
