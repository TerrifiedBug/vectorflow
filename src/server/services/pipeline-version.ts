import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";

/**
 * Creates an immutable pipeline version snapshot with auto-incrementing
 * version number. Each version stores the full YAML config at the time of
 * creation and cannot be modified afterwards.
 */
export async function createVersion(
  pipelineId: string,
  configYaml: string,
  userId: string,
  changelog?: string,
  logLevel?: string | null,
) {
  // Find the highest existing version number for this pipeline
  const latest = await prisma.pipelineVersion.findFirst({
    where: { pipelineId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const nextVersion = (latest?.version ?? 0) + 1;

  const version = await prisma.pipelineVersion.create({
    data: {
      pipelineId,
      version: nextVersion,
      configYaml,
      logLevel: logLevel ?? null,
      createdById: userId,
      changelog,
    },
  });

  // Mark the pipeline as deployed
  await prisma.pipeline.update({
    where: { id: pipelineId },
    data: { isDraft: false, deployedAt: new Date() },
  });

  return version;
}

/**
 * List all versions for a pipeline, ordered newest first.
 */
export async function listVersions(pipelineId: string) {
  return prisma.pipelineVersion.findMany({
    where: { pipelineId },
    orderBy: { version: "desc" },
  });
}

/**
 * Get a single pipeline version by its ID.
 */
export async function getVersion(versionId: string) {
  const version = await prisma.pipelineVersion.findUnique({
    where: { id: versionId },
  });
  if (!version) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pipeline version not found",
    });
  }
  return version;
}

/**
 * Rollback a pipeline to a target version by creating a NEW version that
 * copies the target version's config. This preserves full version history
 * rather than mutating existing records.
 */
export async function rollback(
  pipelineId: string,
  targetVersionId: string,
  userId: string,
) {
  const targetVersion = await prisma.pipelineVersion.findUnique({
    where: { id: targetVersionId },
  });

  if (!targetVersion) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Target version not found",
    });
  }

  if (targetVersion.pipelineId !== pipelineId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Target version does not belong to this pipeline",
    });
  }

  return createVersion(
    pipelineId,
    targetVersion.configYaml,
    userId,
    `Rollback to version ${targetVersion.version}`,
    targetVersion.logLevel,
  );
}
