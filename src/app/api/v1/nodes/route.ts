import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
