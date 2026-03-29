import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../../_lib/api-handler";
import { validateConfig } from "@/server/services/validator";
import type { TranslationResult } from "@/server/services/migration/types";
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

  if (!project.translatedBlocks) {
    return NextResponse.json(
      { error: "Run translate first" },
      { status: 400 },
    );
  }

  const translationResult = project.translatedBlocks as unknown as TranslationResult;
  const result = await validateConfig(translationResult.vectorYaml);

  await prisma.migrationProject.update({
    where: { id },
    data: {
      validationResult: result as unknown as Prisma.InputJsonValue,
      status: result.valid ? "READY" : "FAILED",
    },
  });

  return NextResponse.json({ validation: result });
});
