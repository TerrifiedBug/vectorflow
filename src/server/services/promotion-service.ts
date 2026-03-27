import { TRPCError } from "@trpc/server";
import { prisma } from "@/lib/prisma";
import { collectSecretRefs, convertSecretRefsToEnvVars } from "./secret-resolver";
import { decryptNodeConfig } from "./config-crypto";
import { copyPipelineGraph } from "./copy-pipeline-graph";
import { fireOutboundWebhooks } from "./outbound-webhook";
import { generateVectorYaml } from "@/lib/config-generator";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PreflightResult {
  missing: string[];
  present: string[];
  canProceed: boolean;
}

export interface ExecutePromotionResult {
  pipelineId: string;
  pipelineName: string;
}

export interface DiffPreviewResult {
  sourceYaml: string;
  targetYaml: string;
}

// ─── Service functions ───────────────────────────────────────────────────────

/**
 * Checks whether all SECRET[name] references used in the source pipeline's
 * node configs exist as named secrets in the target environment.
 *
 * Returns { missing, present, canProceed } without throwing.
 */
export async function preflightSecrets(
  pipelineId: string,
  targetEnvironmentId: string,
): Promise<PreflightResult> {
  const nodes = await prisma.pipelineNode.findMany({
    where: { pipelineId },
    select: { componentType: true, config: true },
  });

  // Collect all SECRET[name] refs from all node configs
  const allRefs = new Set<string>();
  for (const node of nodes) {
    const config = (node.config ?? {}) as Record<string, unknown>;
    const decrypted = decryptNodeConfig(node.componentType, config);
    const refs = collectSecretRefs(decrypted);
    for (const ref of refs) {
      allRefs.add(ref);
    }
  }

  if (allRefs.size === 0) {
    return { missing: [], present: [], canProceed: true };
  }

  // Query which secrets exist in target environment
  const existingSecrets = await prisma.secret.findMany({
    where: {
      environmentId: targetEnvironmentId,
      name: { in: Array.from(allRefs) },
    },
    select: { name: true },
  });

  const presentNames = new Set(existingSecrets.map((s) => s.name));
  const present: string[] = [];
  const missing: string[] = [];

  for (const ref of allRefs) {
    if (presentNames.has(ref)) {
      present.push(ref);
    } else {
      missing.push(ref);
    }
  }

  return {
    missing,
    present,
    canProceed: missing.length === 0,
  };
}

/**
 * Executes the promotion by creating the target pipeline via copyPipelineGraph.
 * SECRET[name] references are preserved intact — they are resolved at deploy time.
 *
 * Must be called after a PromotionRequest record exists in DB.
 * Updates the PromotionRequest with targetPipelineId, status DEPLOYED, deployedAt.
 * Fires promotion_completed outbound webhook after success (non-blocking).
 */
export async function executePromotion(
  requestId: string,
  executorId: string,
): Promise<ExecutePromotionResult> {
  // Load the request and source pipeline info
  const request = await prisma.promotionRequest.findUnique({
    where: { id: requestId },
    include: {
      sourcePipeline: {
        select: {
          name: true,
          description: true,
          environmentId: true,
          environment: { select: { teamId: true } },
        },
      },
      targetEnvironment: { select: { name: true, teamId: true } },
    },
  });

  if (!request) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Promotion request not found" });
  }

  const targetPipelineName = request.targetPipelineName ?? request.sourcePipeline.name;
  const teamId = request.sourcePipeline.environment.teamId;

  // Execute in a transaction: create target pipeline + copy graph + update request
  const { targetPipelineId } = await prisma.$transaction(async (tx) => {
    // Check for name collision in target environment
    const existing = await tx.pipeline.findFirst({
      where: {
        environmentId: request.targetEnvironmentId,
        name: targetPipelineName,
      },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A pipeline named "${targetPipelineName}" already exists in the target environment`,
      });
    }

    // Create the target pipeline
    const targetPipeline = await tx.pipeline.create({
      data: {
        name: targetPipelineName,
        description: request.sourcePipeline.description ?? undefined,
        environmentId: request.targetEnvironmentId,
        globalConfig: request.globalConfigSnapshot ?? undefined,
        isDraft: true,
        createdById: executorId,
        updatedById: executorId,
      },
    });

    // Copy nodes and edges from source pipeline WITHOUT stripping SECRET[name] refs.
    // SECRET resolution happens at deploy time via secret-resolver.ts.
    await copyPipelineGraph(tx, {
      sourcePipelineId: request.sourcePipelineId,
      targetPipelineId: targetPipeline.id,
      stripSharedComponentLinks: true,
      // No transformConfig — preserves SECRET[name] refs intact
    });

    // Mark request as DEPLOYED
    await tx.promotionRequest.update({
      where: { id: requestId },
      data: {
        targetPipelineId: targetPipeline.id,
        status: "DEPLOYED",
        approvedById: executorId,
        reviewedAt: new Date(),
        deployedAt: new Date(),
      },
    });

    return { targetPipelineId: targetPipeline.id };
  });

  // Fire outbound webhook after successful promotion (non-blocking)
  void fireOutboundWebhooks("promotion_completed", teamId ?? "", {
    type: "promotion_completed",
    timestamp: new Date().toISOString(),
    data: {
      promotionRequestId: requestId,
      sourcePipelineId: request.sourcePipelineId,
      targetPipelineId,
      sourceEnvironmentId: request.sourceEnvironmentId,
      targetEnvironmentId: request.targetEnvironmentId,
      promotedBy: request.promotedById,
    },
  });

  return { pipelineId: targetPipelineId, pipelineName: targetPipelineName };
}

/**
 * Generates a side-by-side YAML diff preview for a pipeline promotion.
 *
 * sourceYaml: Generated with SECRET[name] refs visible (as-stored).
 * targetYaml: Generated with SECRET[name] refs converted to ${VF_SECRET_NAME} env var placeholders.
 */
export async function generateDiffPreview(
  pipelineId: string,
): Promise<DiffPreviewResult> {
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    include: {
      nodes: true,
      edges: true,
      environment: { select: { name: true } },
    },
  });

  if (!pipeline) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
  }

  const flowEdges = pipeline.edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
  }));

  // Source YAML: decrypt node configs but keep SECRET[name] refs as-is
  const sourceFlowNodes = pipeline.nodes.map((n) => ({
    id: n.id,
    type: n.kind.toLowerCase(),
    position: { x: n.positionX, y: n.positionY },
    data: {
      componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
      componentKey: n.componentKey,
      config: decryptNodeConfig(n.componentType, (n.config as Record<string, unknown>) ?? {}),
      disabled: n.disabled,
    },
  }));

  const sourceYaml = generateVectorYaml(
    sourceFlowNodes as Parameters<typeof generateVectorYaml>[0],
    flowEdges as Parameters<typeof generateVectorYaml>[1],
    pipeline.globalConfig as Record<string, unknown> | null,
    null,
  );

  // Target YAML: convert SECRET[name] refs to ${VF_SECRET_NAME} env var placeholders
  const targetFlowNodes = pipeline.nodes.map((n) => {
    const decrypted = decryptNodeConfig(n.componentType, (n.config as Record<string, unknown>) ?? {});
    const converted = convertSecretRefsToEnvVars(decrypted);
    return {
      id: n.id,
      type: n.kind.toLowerCase(),
      position: { x: n.positionX, y: n.positionY },
      data: {
        componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
        componentKey: n.componentKey,
        config: converted,
        disabled: n.disabled,
      },
    };
  });

  const targetYaml = generateVectorYaml(
    targetFlowNodes as Parameters<typeof generateVectorYaml>[0],
    flowEdges as Parameters<typeof generateVectorYaml>[1],
    pipeline.globalConfig as Record<string, unknown> | null,
    null,
  );

  return { sourceYaml, targetYaml };
}
