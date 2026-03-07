import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { createVersion } from "@/server/services/pipeline-version";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { startSystemVector, stopSystemVector } from "@/server/services/system-vector";
import { gitSyncCommitPipeline } from "@/server/services/git-sync";

export interface AgentDeployResult {
  success: boolean;
  error?: string;
  versionId?: string;
  versionNumber?: number;
  validationErrors?: Array<{ message: string; componentKey?: string }>;
  gitSyncError?: string;
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

  if (prebuiltConfigYaml) {
    // Use the reviewed snapshot as-is
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
    let enrichment: { environmentName: string; pipelineVersion: number } | null = null;
    if (pipeline.enrichMetadata) {
      const latestVer = await prisma.pipelineVersion.findFirst({
        where: { pipelineId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      enrichment = {
        environmentName: pipeline.environment.name,
        pipelineVersion: (latestVer?.version ?? 0) + 1,
      };
    }

    configYaml = generateVectorYaml(
      flowNodes as Parameters<typeof generateVectorYaml>[0],
      flowEdges as Parameters<typeof generateVectorYaml>[1],
      pipeline.globalConfig as Record<string, unknown> | null,
      enrichment,
    );
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
  const version = await createVersion(
    pipelineId,
    configYaml,
    userId,
    changelog ?? (pipeline.isSystem ? "Deployed via system vector" : "Deployed via agent mode"),
    logLevel,
    gc,
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
      configYaml,
      { name: user?.name ?? (isServiceAccount ? "VectorFlow Service Account" : "VectorFlow User"), email: user?.email ?? "noreply@vectorflow" },
      changelog ?? `Deploy pipeline: ${pipeline.name}`,
    );
    if (!result.success) {
      gitSyncError = result.error;
    }
  }

  // 4. For system pipelines, start the local Vector process instead of
  //    relying on agents to pick up the config.
  if (pipeline.isSystem) {
    await startSystemVector(configYaml);
  }

  return {
    success: true,
    versionId: version.id,
    versionNumber: version.version,
    gitSyncError,
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
