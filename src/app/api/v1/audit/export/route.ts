import { NextRequest, NextResponse } from "next/server";
import { apiRoute } from "@/app/api/v1/_lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  formatAuditCsv,
  formatAuditJson,
  formatAuditJsonChain,
  type ChainAuditLogItem,
} from "@/server/services/audit-export";

export const GET = apiRoute(
  "audit.export",
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);

    const format = searchParams.get("format") ?? "csv";
    if (format !== "csv" && format !== "json" && format !== "chain") {
      return NextResponse.json(
        { error: 'Invalid format — must be "csv", "json", or "chain"' },
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

    // ─── Chain-format contiguity guard ────────────────────────────────────
    // The chain envelope verifier anchors the first row to genesisHashFor(orgId)
    // and requires every row's prevHash to chain through. Any filter that
    // omits earlier rows breaks contiguity, so chain exports MUST be
    // unfiltered and ordered ASC (oldest → newest).
    if (format === "chain") {
      if (from || to || action || entityType || userId) {
        return NextResponse.json(
          {
            error:
              "format=chain exports must be unfiltered — apply filters in a follow-up step on the downloaded envelope. Remove from/to/action/entityType/userId.",
          },
          { status: 400 },
        );
      }
    }

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

    // For chain exports, fetch the org's chain from the *beginning* (ASC),
    // so the cap (`limit`) caps the chain at the front, preserving genesis
    // anchor. For csv/json display, keep the existing newest-first order.
    const items = await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: format === "chain" ? "asc" : "desc" },
      take: limit,
    });

    if (format === "chain") {
      // Resolve the environment's organizationId — the chain envelope must
      // declare the org so the verifier can derive the right genesis hash.
      const env = await prisma.environment.findUnique({
        where: { id: ctx.environmentId },
        select: { organizationId: true },
      });
      const orgId = env?.organizationId;
      if (!orgId) {
        return NextResponse.json(
          { error: "Could not resolve organization for environment" },
          { status: 400 },
        );
      }
      const json = formatAuditJsonChain(
        items as unknown as ChainAuditLogItem[],
        orgId,
      );
      return new NextResponse(json, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="audit-chain-export-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      });
    }

    if (format === "json") {
      const json = formatAuditJson(items);
      return new NextResponse(json, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
  "read",
);
