import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../../_lib/api-handler";

export const GET = apiRoute("migration.read", async (_req, _ctx, params) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const project = await prisma.migrationProject.findUnique({
    where: { id },
    include: {
      generatedPipeline: { select: { id: true, name: true } },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ project });
}, "read");

export const DELETE = apiRoute("migration.write", async (_req, _ctx, params) => {
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

  await prisma.migrationProject.delete({ where: { id } });

  return NextResponse.json({ success: true });
});
