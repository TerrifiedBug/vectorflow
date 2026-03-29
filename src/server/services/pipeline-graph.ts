import { TRPCError } from "@trpc/server";
import { prisma } from "@/lib/prisma";
import { ComponentKind, Prisma } from "@/generated/prisma";
import { encryptNodeConfig, decryptNodeConfig } from "@/server/services/config-crypto";
import { copyPipelineGraph } from "@/server/services/copy-pipeline-graph";
import { generateVectorYaml } from "@/lib/config-generator";
import { stripEnvRefs, type StrippedRef } from "@/server/services/strip-env-refs";

type Tx = Prisma.TransactionClient;

/* ------------------------------------------------------------------ */
/*  ListPipelinesOptions — filter/sort/pagination for pipeline list   */
/* ------------------------------------------------------------------ */

export interface ListPipelinesOptions {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: string[];      // "deployed" | "draft" | "error"
  tags?: string[];
  groupId?: string;
  sortBy?: "name" | "updatedAt" | "deployedAt";
  sortOrder?: "asc" | "desc";
}

/* ------------------------------------------------------------------ */
/*  saveGraph — component validation + node/edge transaction body     */
/* ------------------------------------------------------------------ */

interface SaveGraphNode {
  id?: string;
  componentKey: string;
  displayName?: string | null;
  componentType: string;
  kind: ComponentKind;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
  disabled: boolean;
  sharedComponentId?: string | null;
  sharedComponentVersion?: number | null;
}

interface SaveGraphEdge {
  id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
}

interface SaveGraphParams {
  pipelineId: string;
  nodes: SaveGraphNode[];
  edges: SaveGraphEdge[];
  globalConfig?: Record<string, unknown> | null;
  userId: string | null;
}

/**
 * Validate shared component references and persist the full graph
 * (nodes + edges) inside an existing transaction.
 *
 * Returns the saved pipeline with decrypted node configs.
 * Does NOT set audit metadata — the router is responsible for that.
 */
export async function saveGraphComponents(
  tx: Tx,
  params: SaveGraphParams,
) {
  const { pipelineId, nodes, edges, globalConfig, userId } = params;

  const existing = await tx.pipeline.findUnique({
    where: { id: pipelineId },
  });
  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pipeline not found",
    });
  }

  // Validate all sharedComponentIds belong to the same environment
  const sharedComponentIds = [
    ...new Set(nodes.map((n) => n.sharedComponentId).filter(Boolean) as string[]),
  ];
  if (sharedComponentIds.length > 0) {
    const sharedComponents = await tx.sharedComponent.findMany({
      where: { id: { in: sharedComponentIds } },
      select: { id: true, environmentId: true, componentType: true, kind: true },
    });
    const scMap = new Map(sharedComponents.map((sc) => [sc.id, sc]));
    for (const scId of sharedComponentIds) {
      if (!scMap.has(scId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Shared component ${scId} not found`,
        });
      }
    }
    for (const sc of sharedComponents) {
      if (sc.environmentId !== existing.environmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Shared component does not belong to this pipeline's environment",
        });
      }
    }
    // Validate componentType/kind match between node and shared component
    for (const node of nodes) {
      if (!node.sharedComponentId) continue;
      const sc = scMap.get(node.sharedComponentId)!;
      if (node.componentType !== sc.componentType || node.kind !== sc.kind) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Node "${node.componentType}" (${node.kind}) does not match shared component "${sc.componentType}" (${sc.kind})`,
        });
      }
    }
  }

  await tx.pipeline.update({
    where: { id: pipelineId },
    data: {
      updatedById: userId,
      ...(globalConfig !== undefined
        ? { globalConfig: (globalConfig ?? undefined) as Prisma.InputJsonValue }
        : {}),
    },
  });

  await tx.pipelineEdge.deleteMany({
    where: { pipelineId },
  });
  await tx.pipelineNode.deleteMany({
    where: { pipelineId },
  });

  await Promise.all(
    nodes.map((node) =>
      tx.pipelineNode.create({
        data: {
          ...(node.id ? { id: node.id } : {}),
          pipelineId,
          componentKey: node.componentKey,
          displayName: node.displayName ?? null,
          componentType: node.componentType,
          kind: node.kind,
          config: encryptNodeConfig(node.componentType, node.config) as Prisma.InputJsonValue,
          positionX: node.positionX,
          positionY: node.positionY,
          disabled: node.disabled,
          sharedComponentId: node.sharedComponentId ?? null,
          sharedComponentVersion: node.sharedComponentVersion ?? null,
        },
      })
    )
  );

  await Promise.all(
    edges.map((edge) =>
      tx.pipelineEdge.create({
        data: {
          ...(edge.id ? { id: edge.id } : {}),
          pipelineId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourcePort: edge.sourcePort,
        },
      })
    )
  );

  const saved = await tx.pipeline.findUniqueOrThrow({
    where: { id: pipelineId },
    include: {
      nodes: true,
      edges: true,
    },
  });
  return {
    ...saved,
    nodes: saved.nodes.map((n) => ({
      ...n,
      config: decryptNodeConfig(
        n.componentType,
        (n.config as Record<string, unknown>) ?? {},
      ),
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  promote — cross-environment pipeline copy with secret stripping   */
/* ------------------------------------------------------------------ */

interface PromotePipelineParams {
  sourcePipelineId: string;
  targetEnvironmentId: string;
  name?: string;
  userId: string | null;
}

interface PromotePipelineResult {
  id: string;
  name: string;
  targetEnvironmentName: string;
  strippedSecrets: StrippedRef[];
  strippedCertificates: StrippedRef[];
}

/**
 * Promote (copy) a pipeline to a different environment, stripping
 * secret and certificate references from node configs and globalConfig.
 *
 * Accepts `userId` instead of the full tRPC context.
 */
export async function promotePipeline(
  params: PromotePipelineParams,
): Promise<PromotePipelineResult> {
  const { sourcePipelineId, targetEnvironmentId, name: overrideName, userId } = params;

  const source = await prisma.pipeline.findUnique({
    where: { id: sourcePipelineId },
    select: {
      name: true,
      description: true,
      environmentId: true,
      globalConfig: true,
      isSystem: true,
      environment: { select: { teamId: true } },
    },
  });
  if (!source) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pipeline not found",
    });
  }
  if (source.isSystem) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "System pipelines cannot be promoted",
    });
  }

  if (source.environmentId === targetEnvironmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Target environment must be different from source environment",
    });
  }

  const targetEnv = await prisma.environment.findUnique({
    where: { id: targetEnvironmentId },
    select: { teamId: true, name: true },
  });
  if (!targetEnv) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Target environment not found",
    });
  }
  if (targetEnv.teamId !== source.environment.teamId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Target environment must belong to the same team",
    });
  }

  const pipelineName = overrideName ?? source.name;

  const allStrippedSecrets: StrippedRef[] = [];
  const allStrippedCertificates: StrippedRef[] = [];

  // Strip secrets/certs from globalConfig if present
  let strippedGlobalConfig = source.globalConfig ?? undefined;
  if (strippedGlobalConfig && typeof strippedGlobalConfig === "object" && !Array.isArray(strippedGlobalConfig)) {
    const globalResult = stripEnvRefs(strippedGlobalConfig as Record<string, unknown>, "__global__");
    strippedGlobalConfig = globalResult.config as typeof strippedGlobalConfig;
    allStrippedSecrets.push(...globalResult.strippedSecrets);
    allStrippedCertificates.push(...globalResult.strippedCertificates);
  }

  const promoted = await prisma.$transaction(async (tx) => {
    // Check name collision inside transaction to avoid TOCTOU race
    const existing = await tx.pipeline.findFirst({
      where: {
        name: pipelineName,
        environmentId: targetEnvironmentId,
      },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A pipeline named "${pipelineName}" already exists in the target environment`,
      });
    }

    const created = await tx.pipeline.create({
      data: {
        name: pipelineName,
        description: source.description,
        environmentId: targetEnvironmentId,
        globalConfig: strippedGlobalConfig,
        isDraft: true,
        createdById: userId,
        updatedById: userId,
      },
    });

    await copyPipelineGraph(tx, {
      sourcePipelineId,
      targetPipelineId: created.id,
      stripSharedComponentLinks: true,
      transformConfig: (config, componentKey) => {
        const result = stripEnvRefs(config, componentKey);
        allStrippedSecrets.push(...result.strippedSecrets);
        allStrippedCertificates.push(...result.strippedCertificates);
        return result.config;
      },
    });

    return created;
  });

  return {
    id: promoted.id,
    name: promoted.name,
    targetEnvironmentName: targetEnv.name,
    strippedSecrets: allStrippedSecrets,
    strippedCertificates: allStrippedCertificates,
  };
}

/* ------------------------------------------------------------------ */
/*  discardChanges — restore pipeline graph from latest version       */
/* ------------------------------------------------------------------ */

/**
 * Discard uncommitted changes by restoring the pipeline's node/edge
 * graph from the latest deployed version snapshot.
 *
 * Validates preconditions (deployed, has snapshot) then runs the
 * restore inside the provided transaction.
 */
export async function discardPipelineChanges(
  pipelineId: string,
): Promise<{ discarded: true }> {
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: { isDraft: true, deployedAt: true },
  });
  if (!pipeline) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
  }
  if (pipeline.isDraft || !pipeline.deployedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Cannot discard changes on a pipeline that has never been deployed",
    });
  }

  const latestVersion = await prisma.pipelineVersion.findFirst({
    where: { pipelineId },
    orderBy: { version: "desc" },
  });
  if (!latestVersion) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No deployed version found" });
  }
  if (!latestVersion.nodesSnapshot || !latestVersion.edgesSnapshot) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Deploy once more to enable discard — this version predates snapshot support",
    });
  }

  const nodes = latestVersion.nodesSnapshot as Array<Record<string, unknown>>;
  const edges = latestVersion.edgesSnapshot as Array<Record<string, unknown>>;

  await prisma.$transaction(async (tx) => {
    await tx.pipeline.update({
      where: { id: pipelineId },
      data: {
        globalConfig: latestVersion.globalConfig as Prisma.InputJsonValue ?? undefined,
      },
    });

    await tx.pipelineEdge.deleteMany({ where: { pipelineId } });
    await tx.pipelineNode.deleteMany({ where: { pipelineId } });

    await Promise.all(
      nodes.map((node) =>
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
            sharedComponentId: ((node as Record<string, unknown>).sharedComponentId as string | null) ?? null,
            sharedComponentVersion: ((node as Record<string, unknown>).sharedComponentVersion as number | null) ?? null,
          },
        })
      )
    );

    await Promise.all(
      edges.map((edge) =>
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
  });

  return { discarded: true };
}

/* ------------------------------------------------------------------ */
/*  detectConfigChanges — YAML-diff between current graph and version */
/* ------------------------------------------------------------------ */

interface DecryptedNode {
  id: string;
  componentType: string;
  componentKey: string;
  kind: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
  disabled: boolean;
}

interface SimpleEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: string | null;
}

interface VersionSnapshot {
  version: number;
  configYaml: string | null;
  logLevel?: string | null;
}

/**
 * Compare the current pipeline graph against a deployed version to
 * detect undeployed config changes. Used by both `list` and `get`
 * endpoints to surface the "has undeployed changes" indicator.
 *
 * Returns `true` if there are config changes that differ from the
 * deployed version, `false` otherwise.
 */
export function detectConfigChanges(params: {
  nodes: DecryptedNode[];
  edges: SimpleEdge[];
  globalConfig: Record<string, unknown> | null;
  enrichMetadata: boolean;
  environmentName: string;
  latestVersion: VersionSnapshot | null | undefined;
}): boolean {
  const { nodes, edges, globalConfig, enrichMetadata, environmentName, latestVersion } = params;

  if (!latestVersion) return true;
  if (!latestVersion.configYaml) return true;

  try {
    const flowNodes = nodes.map((n) => ({
      id: n.id,
      type: n.kind.toLowerCase(),
      position: { x: n.positionX, y: n.positionY },
      data: {
        componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
        componentKey: n.componentKey,
        config: n.config,
        disabled: n.disabled,
      },
    }));
    const flowEdges = edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
    }));
    const enrichment = enrichMetadata
      ? { environmentName, pipelineVersion: latestVersion.version }
      : null;
    const currentYaml = generateVectorYaml(
      flowNodes as Parameters<typeof generateVectorYaml>[0],
      flowEdges as Parameters<typeof generateVectorYaml>[1],
      globalConfig,
      enrichment,
    );

    if (currentYaml !== latestVersion.configYaml) return true;

    // Also check if log level changed (stripped from YAML, passed as VECTOR_LOG env var)
    const currentLogLevel = globalConfig?.log_level ?? null;
    const deployedLogLevel = latestVersion.logLevel ?? null;
    if (currentLogLevel !== deployedLogLevel) return true;

    return false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  listPipelinesForEnvironment — query + map for pipeline list view  */
/* ------------------------------------------------------------------ */

/**
 * Fetch all pipelines for an environment with computed fields:
 * `hasUndeployedChanges`, `hasStaleComponents`, `staleComponentNames`.
 *
 * This is the data assembly behind the `pipeline.list` tRPC endpoint.
 */
export async function listPipelinesForEnvironment(
  environmentId: string,
  options: ListPipelinesOptions = {},
) {
  const {
    cursor,
    limit: rawLimit,
    search,
    status,
    tags,
    groupId,
    sortBy,
    sortOrder,
  } = options;

  const limit = Math.min(rawLimit ?? 50, 200);

  // Build filter conditions (like audit.list pattern)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [{ environmentId }];

  if (search) {
    conditions.push({ name: { contains: search, mode: "insensitive" } });
  }

  if (status && status.length > 0) {
    if (status.includes("deployed")) {
      conditions.push({ isDraft: false, deployedAt: { not: null } });
    }
    if (status.includes("draft")) {
      conditions.push({ isDraft: true });
    }
  }

  if (tags && tags.length > 0) {
    conditions.push({
      tags: { array_contains: tags },
    });
  }

  if (groupId) {
    conditions.push({ groupId });
  }

  const where = { AND: conditions };

  // Determine orderBy from sortBy/sortOrder
  let orderBy: Record<string, string>;
  switch (sortBy) {
    case "name":
      orderBy = { name: sortOrder ?? "asc" };
      break;
    case "deployedAt":
      orderBy = { deployedAt: sortOrder ?? "desc" };
      break;
    default:
      orderBy = { updatedAt: sortOrder ?? "desc" };
      break;
  }

  const pipelineSelect = {
    id: true,
    name: true,
    description: true,
    isDraft: true,
    deployedAt: true,
    createdAt: true,
    updatedAt: true,
    globalConfig: true,
    tags: true,
    enrichMetadata: true,
    groupId: true,
    group: { select: { id: true, name: true, color: true } },
    environment: { select: { name: true } },
    createdBy: { select: { name: true, email: true, image: true } },
    updatedBy: { select: { name: true, email: true, image: true } },
    nodeStatuses: {
      select: {
        status: true,
        eventsIn: true,
        eventsOut: true,
        errorsTotal: true,
        eventsDiscarded: true,
        bytesIn: true,
        bytesOut: true,
        uptimeSeconds: true,
      },
    },
    nodes: {
      select: {
        id: true,
        componentType: true,
        componentKey: true,
        kind: true,
        config: true,
        positionX: true,
        positionY: true,
        disabled: true,
        sharedComponentId: true,
        sharedComponentVersion: true,
        sharedComponent: {
          select: { version: true, name: true },
        },
      },
    },
    edges: {
      select: {
        id: true,
        sourceNodeId: true,
        targetNodeId: true,
        sourcePort: true,
      },
    },
    _count: {
      select: { upstreamDeps: true, downstreamDeps: true },
    },
    versions: {
      orderBy: { version: "desc" as const },
      take: 1,
      select: { version: true, configYaml: true, logLevel: true },
    },
  };

  const [rawPipelines, totalCount] = await Promise.all([
    prisma.pipeline.findMany({
      where,
      select: pipelineSelect,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.pipeline.count({ where }),
  ]);

  // Detect next cursor via overfetch
  let nextCursor: string | undefined;
  if (rawPipelines.length > limit) {
    rawPipelines.pop();
    nextCursor = rawPipelines[rawPipelines.length - 1]?.id;
  }

  const pipelines = await Promise.all(rawPipelines.map(async (p) => {
    let hasUndeployedChanges = false;
    if (!p.isDraft && p.deployedAt) {
      const latestVersion = p.versions[0];
      const decryptedNodes = p.nodes.map((n) => ({
        ...n,
        config: decryptNodeConfig(
          n.componentType,
          (n.config as Record<string, unknown>) ?? {},
        ),
      }));
      hasUndeployedChanges = detectConfigChanges({
        nodes: decryptedNodes,
        edges: p.edges,
        globalConfig: p.globalConfig as Record<string, unknown> | null,
        enrichMetadata: p.enrichMetadata,
        environmentName: p.environment.name,
        latestVersion: latestVersion
          ? { version: latestVersion.version, configYaml: latestVersion.configYaml, logLevel: latestVersion.logLevel }
          : null,
      });
    }

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      isDraft: p.isDraft,
      deployedAt: p.deployedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      tags: (p.tags as string[]) ?? [],
      groupId: p.groupId,
      group: p.group,
      createdBy: p.createdBy,
      updatedBy: p.updatedBy,
      nodeStatuses: p.nodeStatuses,
      hasUndeployedChanges,
      hasStaleComponents: p.nodes.some(
        (n) => n.sharedComponentId && n.sharedComponent && (n.sharedComponentVersion ?? 0) < n.sharedComponent.version
      ),
      staleComponentNames: p.nodes
        .filter((n) => n.sharedComponentId && n.sharedComponent && (n.sharedComponentVersion ?? 0) < n.sharedComponent.version)
        .map((n) => n.sharedComponent!.name),
      upstreamDepCount: p._count.upstreamDeps,
      downstreamDepCount: p._count.downstreamDeps,
      minUptimeSeconds: (() => {
        const runningUptimes = p.nodeStatuses
          .filter((s) => s.status === "RUNNING" && s.uptimeSeconds != null)
          .map((s) => s.uptimeSeconds!);
        return runningUptimes.length > 0 ? Math.min(...runningUptimes) : null;
      })(),
    };
  }));

  return { pipelines, nextCursor, totalCount };
}
