import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { createVersion } from "@/server/services/pipeline-version";
import { queryHealth } from "@/server/integrations/vector-graphql";

export interface NodeDeployResult {
  nodeId: string;
  nodeName: string;
  host: string;
  success: boolean;
  error?: string;
  healthAfter?: boolean;
}

export interface DeployResult {
  success: boolean;
  versionId?: string;
  versionNumber?: number;
  nodeResults: NodeDeployResult[];
  validationErrors?: Array<{ message: string; componentKey?: string }>;
}

/**
 * Deploy a pipeline via API reload. This sends the generated YAML config
 * to each Vector node's reload endpoint in the target environment, then
 * verifies health and creates a version snapshot.
 */
export async function deployApiReload(
  pipelineId: string,
  environmentId: string,
  userId: string,
): Promise<DeployResult> {
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

  // Convert DB nodes/edges to the format generateVectorYaml expects
  const flowNodes = pipeline.nodes.map((n) => ({
    id: n.id,
    type: n.kind.toLowerCase(),
    position: { x: n.positionX, y: n.positionY },
    data: {
      componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
      componentKey: n.componentKey,
      config: n.config as Record<string, unknown>,
    },
  }));

  const flowEdges = pipeline.edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
  }));

  // 2. Generate YAML
  const configYaml = generateVectorYaml(flowNodes as any, flowEdges as any);

  // 3. Validate config
  const validation = await validateConfig(configYaml);
  if (!validation.valid) {
    return {
      success: false,
      nodeResults: [],
      validationErrors: validation.errors,
    };
  }

  // 4. Get Vector nodes in the environment
  const vectorNodes = await prisma.vectorNode.findMany({
    where: { environmentId },
  });

  if (vectorNodes.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No Vector nodes found in this environment",
    });
  }

  // 5. POST config to each node's reload endpoint
  const nodeResults: NodeDeployResult[] = await Promise.all(
    vectorNodes.map(async (node) => {
      try {
        const reloadUrl = `http://${node.host}:${node.apiPort}/api/v1/config/reload`;
        const response = await fetch(reloadUrl, {
          method: "POST",
          headers: { "Content-Type": "text/yaml" },
          body: configYaml,
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "Unknown error");
          return {
            nodeId: node.id,
            nodeName: node.name,
            host: node.host,
            success: false,
            error: `HTTP ${response.status}: ${body}`,
          };
        }

        // 6. Verify health after reload
        const health = await queryHealth(node.host, node.apiPort);

        return {
          nodeId: node.id,
          nodeName: node.name,
          host: node.host,
          success: true,
          healthAfter: health.healthy,
        };
      } catch (err: any) {
        return {
          nodeId: node.id,
          nodeName: node.name,
          host: node.host,
          success: false,
          error: err.message || "Failed to connect",
        };
      }
    }),
  );

  const allSucceeded = nodeResults.every((r) => r.success);

  // 7. Create pipeline version (even on partial success to record the attempt)
  let version;
  if (allSucceeded) {
    version = await createVersion(
      pipelineId,
      configYaml,
      userId,
      `Deployed via API reload to ${vectorNodes.length} node(s)`,
    );
  }

  // 8. Write audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: "DEPLOY_API_RELOAD",
      entityType: "Pipeline",
      entityId: pipelineId,
      metadata: {
        environmentId,
        success: allSucceeded,
        nodeResults: nodeResults.map((r) => ({
          nodeId: r.nodeId,
          success: r.success,
          error: r.error,
        })),
        versionId: version?.id,
      },
    },
  });

  return {
    success: allSucceeded,
    versionId: version?.id,
    versionNumber: version?.version,
    nodeResults,
  };
}
