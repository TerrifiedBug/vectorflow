import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiRoute } from "../_lib/api-handler";

export const GET = apiRoute("pipelines.read", async (_req, ctx) => {
  const pipelines = await prisma.pipeline.findMany({
    where: { environmentId: ctx.environmentId },
    select: {
      id: true,
      name: true,
      description: true,
      isDraft: true,
      deployedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ pipelines });
});
