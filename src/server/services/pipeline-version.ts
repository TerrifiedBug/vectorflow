import { prisma } from "@/lib/prisma";
import { type Prisma, type ComponentKind } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

/**
 * Creates an immutable pipeline version snapshot with auto-incrementing
 * version number. Each version stores the full YAML config at the time of
 * creation and cannot be modified afterwards.
 */
export async function createVersion(
  pipelineId: string,
  configYaml: string | ((version: number) => string),
  userId: string,
  changelog?: string,
  logLevel?: string | null,
  globalConfig?: Record<string, unknown> | null,
  nodesSnapshot?: unknown,
  edgesSnapshot?: unknown,
) {
  // Find the highest existing version number for this pipeline
  const latest = await prisma.pipelineVersion.findFirst({
    where: { pipelineId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const nextVersion = (latest?.version ?? 0) + 1;
  const finalYaml = typeof configYaml === "function" ? configYaml(nextVersion) : configYaml;

  const version = await prisma.pipelineVersion.create({
    data: {
      pipelineId,
      version: nextVersion,
      configYaml: finalYaml,
      logLevel: logLevel ?? null,
      globalConfig: (globalConfig as Prisma.InputJsonValue) ?? undefined,
      nodesSnapshot: nodesSnapshot ? (nodesSnapshot as Prisma.InputJsonValue) : undefined,
      edgesSnapshot: edgesSnapshot ? (edgesSnapshot as Prisma.InputJsonValue) : undefined,
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

  // Restore pipeline state atomically: globalConfig + nodes/edges from snapshots
  await prisma.$transaction(async (tx) => {
    if (targetVersion.globalConfig !== undefined) {
      await tx.pipeline.update({
        where: { id: pipelineId },
        data: {
          globalConfig: targetVersion.globalConfig as Prisma.InputJsonValue ?? undefined,
        },
      });
    }

    if (targetVersion.nodesSnapshot && targetVersion.edgesSnapshot) {
      const snapshotNodes = targetVersion.nodesSnapshot as Array<Record<string, unknown>>;
      const snapshotEdges = targetVersion.edgesSnapshot as Array<Record<string, unknown>>;

      await tx.pipelineEdge.deleteMany({ where: { pipelineId } });
      await tx.pipelineNode.deleteMany({ where: { pipelineId } });

      await Promise.all(
        snapshotNodes.map((node) =>
          tx.pipelineNode.create({
            data: {
              id: node.id as string,
              pipelineId,
              componentKey: node.componentKey as string,
              displayName: (node.displayName as string) ?? null,
              componentType: node.componentType as string,
              kind: node.kind as ComponentKind,
              config: node.config as Prisma.InputJsonValue,
              positionX: node.positionX as number,
              positionY: node.positionY as number,
              disabled: (node.disabled as boolean) ?? false,
            },
          })
        )
      );

      await Promise.all(
        snapshotEdges.map((edge) =>
          tx.pipelineEdge.create({
            data: {
              id: edge.id as string,
              pipelineId,
              sourceNodeId: edge.sourceNodeId as string,
              targetNodeId: edge.targetNodeId as string,
              sourcePort: (edge.sourcePort as string) ?? null,
            },
          })
        )
      );
    }
  });

  return createVersion(
    pipelineId,
    targetVersion.configYaml,
    userId,
    `Rollback to version ${targetVersion.version}`,
    targetVersion.logLevel,
    targetVersion.globalConfig as Record<string, unknown> | null,
    targetVersion.nodesSnapshot,
    targetVersion.edgesSnapshot,
  );
}
