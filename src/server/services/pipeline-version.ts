import { prisma } from "@/lib/prisma";
import { type Prisma, type ComponentKind } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";
import { relayPush } from "@/server/services/push-broadcast";
import { errorLog } from "@/lib/logger";

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
 * Lightweight version summary — returns metadata and author info
 * but excludes heavy blob fields (configYaml, nodesSnapshot, edgesSnapshot, etc.).
 */
export async function listVersionsSummary(pipelineId: string) {
  return prisma.pipelineVersion.findMany({
    where: { pipelineId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      pipelineId: true,
      version: true,
      changelog: true,
      createdById: true,
      createdAt: true,
      createdBy: {
        select: { name: true, email: true },
      },
    },
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

/**
 * Deploy from a historical version: restore pipeline graph state from
 * the source version's snapshots, create a new version, and send push
 * notifications to matching agents.
 *
 * Returns the new version and the list of node IDs that received a push
 * so the caller can fire SSE + audit events.
 */
export async function deployFromVersion(
  pipelineId: string,
  sourceVersionId: string,
  userId: string,
  changelog?: string,
): Promise<{ version: Awaited<ReturnType<typeof createVersion>>; pushedNodeIds: string[] }> {
  // 1. Fetch and validate the source version
  const sourceVersion = await prisma.pipelineVersion.findUnique({
    where: { id: sourceVersionId },
  });

  if (!sourceVersion) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Source version not found",
    });
  }

  if (sourceVersion.pipelineId !== pipelineId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Source version does not belong to this pipeline",
    });
  }

  // 2. Restore pipeline graph state from source version's snapshots
  await prisma.$transaction(async (tx) => {
    if (sourceVersion.globalConfig !== undefined) {
      await tx.pipeline.update({
        where: { id: pipelineId },
        data: {
          globalConfig: sourceVersion.globalConfig as Prisma.InputJsonValue ?? undefined,
        },
      });
    }

    if (sourceVersion.nodesSnapshot && sourceVersion.edgesSnapshot) {
      const snapshotNodes = sourceVersion.nodesSnapshot as Array<Record<string, unknown>>;
      const snapshotEdges = sourceVersion.edgesSnapshot as Array<Record<string, unknown>>;

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

  // 3. Create a new version with the source version's config/snapshots
  const version = await createVersion(
    pipelineId,
    sourceVersion.configYaml,
    userId,
    changelog ?? `Deploy from version ${sourceVersion.version}`,
    sourceVersion.logLevel,
    sourceVersion.globalConfig as Record<string, unknown> | null,
    sourceVersion.nodesSnapshot,
    sourceVersion.edgesSnapshot,
  );

  // 4. Send push notifications to matching agents
  const pushedNodeIds: string[] = [];
  try {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId },
      select: { environmentId: true, nodeSelector: true },
    });
    if (pipeline) {
      const nodeSelector = pipeline.nodeSelector as Record<string, string> | null;
      const targetNodes = await prisma.vectorNode.findMany({
        where: { environmentId: pipeline.environmentId },
        select: { id: true, labels: true },
      });
      for (const node of targetNodes) {
        const labels = (node.labels as Record<string, string>) ?? {};
        const selectorEntries = Object.entries(nodeSelector ?? {});
        const matches = selectorEntries.every(([k, v]) => labels[k] === v);
        if (matches) {
          const sent = relayPush(node.id, {
            type: "config_changed",
            pipelineId,
            reason: "deploy_from_version",
          });
          if (sent) pushedNodeIds.push(node.id);
        }
      }
    }
  } catch (err) {
    errorLog("pipeline-version", "Push notification failed", err);
  }

  return { version, pushedNodeIds };
}
