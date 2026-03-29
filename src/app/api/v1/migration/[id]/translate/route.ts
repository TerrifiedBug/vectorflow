import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";
import { translateBlocks } from "@/server/services/migration/ai-translator";
import type { ParsedConfig } from "@/server/services/migration/types";
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

  if (!project.parsedTopology) {
    return NextResponse.json(
      { error: "Run parse first" },
      { status: 400 },
    );
  }

  await prisma.migrationProject.update({
    where: { id },
    data: { status: "TRANSLATING" },
  });

  try {
    const parsedConfig = project.parsedTopology as unknown as ParsedConfig;

    const result = await translateBlocks({
      teamId: project.teamId,
      parsedConfig,
      platform: project.platform,
    });

    await prisma.migrationProject.update({
      where: { id },
      data: {
        translatedBlocks: result as unknown as Prisma.InputJsonValue,
        status: "READY",
      },
    });

    return NextResponse.json({ translation: result });
  } catch (err) {
    await prisma.migrationProject.update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Translation failed",
      },
    });

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Translation failed" },
      { status: 500 },
    );
  }
});
