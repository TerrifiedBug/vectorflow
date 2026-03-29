import { PrismaClient } from "@/generated/prisma";

const prisma = new PrismaClient();

function toFilenameSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "unnamed";
}

async function backfill() {
  // Find all pipelines in environments with active git sync
  const pipelines = await prisma.pipeline.findMany({
    where: {
      gitPath: null,
      environment: {
        gitRepoUrl: { not: null },
        gitOpsMode: { not: "off" },
      },
    },
    include: {
      environment: { select: { name: true } },
    },
  });

  console.log(`Found ${pipelines.length} pipelines to backfill`);

  for (const pipeline of pipelines) {
    const envSlug = toFilenameSlug(pipeline.environment.name);
    const pipelineSlug = toFilenameSlug(pipeline.name);
    const gitPath = `${envSlug}/${pipelineSlug}.yaml`;

    await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { gitPath },
    });

    console.log(`  ${pipeline.name} -> ${gitPath}`);
  }

  console.log("Backfill complete");
}

backfill()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
