import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";
import { parseFluentdConfig } from "@/server/services/migration/fluentd-parser";
import { computeReadiness } from "@/server/services/migration/readiness";
import type { Prisma } from "@/generated/prisma";

export const POST = apiRoute("migration.write", async (_req, _ctx, params) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const project = await prisma.migrationProject.findUnique({
    where: { id },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsedConfig = parseFluentdConfig(project.originalConfig);
  const readinessReport = computeReadiness(parsedConfig);

  await prisma.migrationProject.update({
    where: { id },
    data: {
      parsedTopology: parsedConfig as unknown as Prisma.InputJsonValue,
      pluginInventory: readinessReport.pluginInventory as unknown as Prisma.InputJsonValue,
      readinessScore: readinessReport.score,
      readinessReport: readinessReport as unknown as Prisma.InputJsonValue,
      status: "DRAFT",
    },
  });

  return NextResponse.json({
    readinessScore: readinessReport.score,
    readinessReport: readinessReport,
    complexity: parsedConfig.complexity,
  });
});
