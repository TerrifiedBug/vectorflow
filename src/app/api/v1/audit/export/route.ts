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

    // csv/json read the env-scoped, filtered, capped slice. chain format
    // queries its own slice below (org-scoped, no cap, no filters).
    const items = format === "chain"
      ? []
      : await prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

    if (format === "chain") {
      // Chain export is ORG-scoped (the verifier anchors to genesisHashFor(orgId)
      // and requires every prevHash link to chain forward). The service account
      // auth context, however, only carries one environmentId. Returning the
      // full org chain would let an env-A service account read env-B's audit
      // rows in the same org — a privilege escalation.
      //
      // Resolution: chain export only works when the service account's env is
      // the ONLY env in its org. The OSS single-env-per-org case behaves
      // exactly as customers expect. Multi-env Cloud orgs must use the
      // org-admin tRPC procedure (forthcoming) which authenticates against the
      // customer admin UI rather than service-account-per-env.
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
      const envCount = await prisma.environment.count({
        where: { organizationId: orgId },
      });
      if (envCount > 1) {
        return NextResponse.json(
          {
            error:
              "chain export is org-scoped and not permitted for this env-scoped service account in a multi-env organization. Use the org-admin chain export endpoint.",
          },
          { status: 403 },
        );
      }

      // Single-env org: env-scope == org-scope. Query by org, no cap, asc,
      // chained rows only. formatAuditJsonChain sorts by chain-link
      // traversal so cross-process same-ms inserts emit in true order.
      const chainItems = await prisma.auditLog.findMany({
        where: { organizationId: orgId, hash: { not: null } },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      const json = formatAuditJsonChain(
        chainItems as unknown as ChainAuditLogItem[],
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
