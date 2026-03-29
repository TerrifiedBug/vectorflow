import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { apiRoute } from "../_lib/api-handler";

export const GET = apiRoute("nodes.read", async (req: NextRequest, ctx) => {
  const labelFilter = req.nextUrl.searchParams.get("label");

  const nodes = await prisma.vectorNode.findMany({
    where: { environmentId: ctx.environmentId },
    select: {
      id: true,
      name: true,
      host: true,
      apiPort: true,
      environmentId: true,
      status: true,
      lastSeen: true,
      lastHeartbeat: true,
      agentVersion: true,
      vectorVersion: true,
      os: true,
      deploymentMode: true,
      maintenanceMode: true,
      maintenanceModeAt: true,
      metadata: true,
      enrolledAt: true,
      createdAt: true,
      environment: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Apply label filtering if requested (labels stored in metadata JSON)
  let filtered = nodes;
  if (labelFilter) {
    const [key, value] = labelFilter.split(":");
    if (key) {
      filtered = nodes.filter((node) => {
        const metadata = node.metadata as Record<string, unknown> | null;
        if (!metadata) return false;
        const labels = metadata.labels as Record<string, string> | undefined;
        if (!labels) return false;
        if (value !== undefined) {
          return labels[key] === value;
        }
        return key in labels;
      });
    }
  }

  return NextResponse.json({ nodes: filtered });
});

export const POST = apiRoute(
  "nodes.manage",
  async (req: NextRequest, ctx) => {
    let body: { name?: string; host?: string; apiPort?: number; labels?: Record<string, string> };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.name || !body.host) {
      return NextResponse.json(
        { error: "name and host are required" },
        { status: 400 },
      );
    }

    const node = await prisma.vectorNode.create({
      data: {
        name: body.name,
        host: body.host,
        apiPort: body.apiPort ?? 8686,
        environmentId: ctx.environmentId,
        labels: body.labels ?? {},
      },
      select: {
        id: true,
        name: true,
        host: true,
        apiPort: true,
        environmentId: true,
        status: true,
        createdAt: true,
      },
    });

    writeAuditLog({
      action: "api.node_created",
      entityType: "VectorNode",
      entityId: node.id,
      userId: null,
      userEmail: null,
      userName: ctx.serviceAccountName ?? "service-account",
      teamId: null,
      environmentId: ctx.environmentId,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      metadata: { name: node.name, host: node.host },
    }).catch(() => {});

    return NextResponse.json({ node }, { status: 201 });
  },
);
