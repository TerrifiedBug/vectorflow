import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";
import { resolveTeamForEnv } from "../../../_lib/resolve-team";
import { parseFluentdConfig } from "@/server/services/migration/fluentd-parser";
import { computeReadiness } from "@/server/services/migration/readiness";
import type { Prisma } from "@/generated/prisma";

export const POST = apiRoute("migration.write", async (_req, ctx, params) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const teamId = await resolveTeamForEnv(ctx.environmentId);

  const project = await prisma.migrationProject.findUnique({
    where: { id },
  });

  if (!project || project.teamId !== teamId) {
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
