import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { errorLog } from "@/lib/logger";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { createVersion } from "@/server/services/pipeline-version";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { startSystemVector, stopSystemVector } from "@/server/services/system-vector";
import { gitSyncCommitPipeline, toFilenameSlug } from "@/server/services/git-sync";
import { relayPush } from "@/server/services/push-broadcast";

export interface AgentDeployResult {
  success: boolean;
  error?: string;
  versionId?: string;
  versionNumber?: number;
  validationErrors?: Array<{ message: string; componentKey?: string }>;
  gitSyncError?: string;
  pushedNodeIds?: string[];
}

/**
 * Deploy a pipeline via Agent mode. Generates and validates the YAML config,
 * creates a new pipeline version, and marks the pipeline as deployed.
 * Agents will pick up the change on their next poll.
 */
export async function deployAgent(
  pipelineId: string,
  userId: string,
  changelog?: string,
  /** When provided, skip YAML regeneration and use this pre-built config
   *  (e.g. the snapshot captured at deploy-request time). */
  prebuiltConfigYaml?: string,
): Promise<AgentDeployResult> {
  // 1. Get pipeline with graph data
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    include: { nodes: true, edges: true, environment: { select: { name: true } } },
  });

  if (!pipeline) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pipeline not found",
    });
  }

  let configYaml: string;
  let configYamlBuilder: ((version: number) => string) | null = null;

  if (prebuiltConfigYaml) {
    // Use the reviewed snapshot as-is (enrichment was baked in at request time)
    configYaml = prebuiltConfigYaml;
  } else {
    // Convert DB nodes/edges to the format generateVectorYaml expects.
    const flowNodes = pipeline.nodes.map((n) => ({
      id: n.id,
      type: n.kind.toLowerCase(),
      position: { x: n.positionX, y: n.positionY },
      data: {
        componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
        componentKey: n.componentKey,
        config: decryptNodeConfig(
          n.componentType,
          (n.config as Record<string, unknown>) ?? {},
        ),
        disabled: n.disabled,
      },
    }));

    const flowEdges = pipeline.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
    }));

    // 2. Generate YAML from current pipeline state
    const buildYaml = (version?: number) => generateVectorYaml(
      flowNodes as Parameters<typeof generateVectorYaml>[0],
      flowEdges as Parameters<typeof generateVectorYaml>[1],
      pipeline.globalConfig as Record<string, unknown> | null,
      pipeline.enrichMetadata && version
        ? { environmentName: pipeline.environment.name, pipelineVersion: version }
        : null,
    );

    // Use non-enriched YAML for validation (enrichment doesn't affect validity)
    configYaml = buildYaml();

    // When enrichment is enabled, pass a builder so createVersion can embed
    // the correct version number atomically
    if (pipeline.enrichMetadata) {
      configYamlBuilder = (v: number) => buildYaml(v);
    }
  }

  const validation = await validateConfig(configYaml);
  if (!validation.valid) {
    return {
      success: false,
      validationErrors: validation.errors,
    };
  }

  // 3. Create pipeline version (also marks pipeline as deployed)
  const gc = pipeline.globalConfig as Record<string, unknown> | null;
  const logLevel = (gc?.log_level as string) ?? null;

  const nodesSnapshot = pipeline.nodes.map((n) => ({
    id: n.id,
    componentKey: n.componentKey,
    displayName: n.displayName,
    componentType: n.componentType,
    kind: n.kind,
    config: n.config,
    positionX: n.positionX,
    positionY: n.positionY,
    disabled: n.disabled,
  }));
  const edgesSnapshot = pipeline.edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourcePort: e.sourcePort,
  }));

  const version = await createVersion(
    pipelineId,
    configYamlBuilder ?? configYaml,
    userId,
    changelog ?? (pipeline.isSystem ? "Deployed via system vector" : "Deployed via agent mode"),
    logLevel,
    gc,
    nodesSnapshot,
    edgesSnapshot,
  );

  // 3b. Git sync (non-blocking side effect)
  let gitSyncError: string | undefined;
  const environment = await prisma.environment.findUnique({
    where: { id: pipeline.environmentId },
  });
  if (environment?.gitRepoUrl && environment?.gitToken) {
    // Service account IDs are prefixed with "sa:" — skip the User lookup for them
    const isServiceAccount = userId.startsWith("sa:");
    const user = isServiceAccount ? null : await prisma.user.findUnique({ where: { id: userId } });
    const result = await gitSyncCommitPipeline(
      {
        repoUrl: environment.gitRepoUrl,
        branch: environment.gitBranch ?? "main",
        encryptedToken: environment.gitToken,
      },
      environment.name,
      pipeline.name,
      version.configYaml,
      { name: user?.name ?? (isServiceAccount ? "VectorFlow Service Account" : "VectorFlow User"), email: user?.email ?? "noreply@vectorflow" },
      changelog ?? `Deploy pipeline: ${pipeline.name}`,
      pipeline.gitPath,
    );
    if (!result.success) {
      gitSyncError = result.error;
    }

    // Queue for retry if git sync failed
    if (!result.success && result.error) {
      const { createGitSyncJob } = await import("@/server/services/git-sync-retry");
      await createGitSyncJob({
        environmentId: pipeline.environmentId,
        pipelineId: pipeline.id,
        action: "commit",
        configYaml: version.configYaml,
        commitMessage: changelog ?? `Deploy pipeline: ${pipeline.name}`,
        authorName: user?.name ?? (isServiceAccount ? "VectorFlow Service Account" : "VectorFlow User"),
        authorEmail: user?.email ?? "noreply@vectorflow",
        error: result.error,
      }).catch((err) => {
        errorLog("deploy-agent", "Failed to create git sync retry job", err);
      });
    }

    // Set gitPath on first successful sync
    if (result.success && !pipeline.gitPath) {
      const derivedPath = `${toFilenameSlug(environment.name)}/${toFilenameSlug(pipeline.name)}.yaml`;
      await prisma.pipeline.update({
        where: { id: pipeline.id },
        data: { gitPath: derivedPath },
      }).catch(() => {}); // Non-blocking
    }
  }

  // 4. For system pipelines, start the local Vector process instead of
  //    relying on agents to pick up the config.
  if (pipeline.isSystem) {
    await startSystemVector(version.configYaml);
  }

  // Notify connected agents that config has changed — they will re-poll
  // to get the full assembled config with secrets and certs resolved.
  const pushedNodeIds: string[] = [];
  if (!pipeline.isSystem) {
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
          reason: "deploy",
        });
        if (sent) pushedNodeIds.push(node.id);
      }
    }
  }

  return {
    success: true,
    versionId: version.id,
    versionNumber: version.version,
    gitSyncError,
    pushedNodeIds,
  };
}

/**
 * Undeploy a pipeline in Agent mode. Marks the pipeline as a draft so
 * agents will stop running it on their next poll.
 * For system pipelines, also stops the local Vector child process.
 */
export async function undeployAgent(
  pipelineId: string,
): Promise<{ success: boolean; error?: string }> {
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
  });

  if (!pipeline) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pipeline not found",
    });
  }

  // Stop local Vector process for system pipelines
  if (pipeline.isSystem) {
    await stopSystemVector();
  }

  await prisma.pipeline.update({
    where: { id: pipelineId },
    data: { isDraft: true, deployedAt: null },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Batch deployment
// ---------------------------------------------------------------------------

/** Default number of pipelines to deploy in parallel. */
const DEFAULT_BATCH_CONCURRENCY = 10;

export interface BatchDeployResult {
  total: number;
  completed: number;
  failed: number;
  results: Array<{
    pipelineId: string;
    success: boolean;
    error?: string;
    versionId?: string;
    versionNumber?: number;
  }>;
}

/**
 * Deploy multiple pipelines in parallel batches.
 *
 * Pipelines are deployed in chunks of `concurrency` (default 10) to avoid
 * overwhelming the database connection pool. Each pipeline within a chunk
 * deploys in parallel; chunks run sequentially.
 */
export async function deployBatch(
  pipelineIds: string[],
  userId: string,
  changelog: string,
  concurrency: number = DEFAULT_BATCH_CONCURRENCY,
): Promise<BatchDeployResult> {
  if (pipelineIds.length === 0) {
    return { total: 0, completed: 0, failed: 0, results: [] };
  }

  const allResults: BatchDeployResult["results"] = [];

  // Process in chunks of `concurrency`
  for (let i = 0; i < pipelineIds.length; i += concurrency) {
    const chunk = pipelineIds.slice(i, i + concurrency);

    const chunkResults = await Promise.allSettled(
      chunk.map(async (pipelineId) => {
        const result = await deployAgent(pipelineId, userId, changelog);
        return { pipelineId, ...result };
      }),
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const settled = chunkResults[j];
      const pipelineId = chunk[j];

      if (settled.status === "fulfilled") {
        const { success, versionId, versionNumber, validationErrors } =
          settled.value;
        allResults.push({
          pipelineId,
          success,
          versionId,
          versionNumber,
          error: success
            ? undefined
            : validationErrors?.map((e) => e.message).join("; ") ??
              "Deployment failed",
        });
      } else {
        allResults.push({
          pipelineId,
          success: false,
          error:
            settled.reason instanceof Error
              ? settled.reason.message
              : "Unknown error",
        });
      }
    }
  }

  const completed = allResults.filter((r) => r.success).length;

  return {
    total: allResults.length,
    completed,
    failed: allResults.length - completed,
    results: allResults,
  };
}
