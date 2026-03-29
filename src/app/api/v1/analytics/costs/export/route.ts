// src/app/api/v1/analytics/costs/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { apiRoute } from "@/app/api/v1/_lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  getCostByPipeline,
  formatCostCsv,
} from "@/server/services/cost-attribution";

export const GET = apiRoute("read", async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const environmentId = searchParams.get("environmentId");
  const range = searchParams.get("range") ?? "30d";

  if (!environmentId) {
    return NextResponse.json({ error: "environmentId is required" }, { status: 400 });
  }

  const validRanges = ["1h", "6h", "1d", "7d", "30d"];
  if (!validRanges.includes(range)) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const env = await prisma.environment.findUnique({
    where: { id: environmentId },
    select: { costPerGbCents: true },
  });
  if (!env) {
    return NextResponse.json({ error: "Environment not found" }, { status: 404 });
  }

  const rows = await getCostByPipeline({
    environmentId,
    range,
    costPerGbCents: env.costPerGbCents,
  });

  const csv = formatCostCsv(rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="cost-report-${range}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
