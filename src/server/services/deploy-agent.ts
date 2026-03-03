import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { createVersion } from "@/server/services/pipeline-version";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { startSystemVector, stopSystemVector } from "@/server/services/system-vector";

export interface AgentDeployResult {
  success: boolean;
  error?: string;
  versionId?: string;
  versionNumber?: number;
  validationErrors?: Array<{ message: string; componentKey?: string }>;
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
): Promise<AgentDeployResult> {
  // 1. Get pipeline with graph data
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    include: { nodes: true, edges: true },
  });

  if (!pipeline) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pipeline not found",
    });
  }

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

  // 2. Generate and validate YAML
  const configYaml = generateVectorYaml(
    flowNodes as any,
    flowEdges as any,
    pipeline.globalConfig as Record<string, unknown> | null,
  );

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

  // 4. For system pipelines, start the local Vector process instead of
  //    relying on agents to pick up the config.
  if (pipeline.isSystem) {
    await startSystemVector(configYaml);
  }

  return {
    success: true,
    versionId: version.id,
    versionNumber: version.version,
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
