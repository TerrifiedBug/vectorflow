import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { createVersion } from "@/server/services/pipeline-version";
import { queryHealth } from "@/server/integrations/vector-graphql";
import { decryptNodeConfig } from "@/server/services/config-crypto";

/**
 * Directory where VectorFlow writes pipeline configs.
 * Mount this as a shared volume with Vector containers and start Vector
 * with --watch-config to auto-reload when files change.
 */
const CONFIG_DIR = process.env.VECTOR_CONFIG_DIR || "";

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
  configWritten?: boolean;
  configPath?: string;
  validationErrors?: Array<{ message: string; componentKey?: string }>;
}

/**
 * Deploy a pipeline via config file write + health check.
 *
 * Writes the generated YAML config to VECTOR_CONFIG_DIR (if configured),
 * checks each fleet node's health via the GraphQL API, and creates a
 * version snapshot.
 *
 * Vector nodes should run with --watch-config to automatically pick up
 * config changes from the shared directory.
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
      config: decryptNodeConfig(n.componentType, (n.config as Record<string, unknown>) ?? {}),
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
      message: "No Vector nodes found in this environment. Add nodes in Fleet settings first.",
    });
  }

  // 5. Write config to shared directory (if configured)
  let configWritten = false;
  let configPath: string | undefined;

  if (CONFIG_DIR) {
    const fileName = `${pipeline.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.yaml`;
    configPath = join(CONFIG_DIR, fileName);
    try {
      await mkdir(CONFIG_DIR, { recursive: true });
      await writeFile(configPath, configYaml, "utf-8");
      configWritten = true;
    } catch (err: any) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to write config to ${configPath}: ${err.message}`,
      });
    }
  }

  // 6. Health check each node
  const nodeResults: NodeDeployResult[] = await Promise.all(
    vectorNodes.map(async (node) => {
      try {
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
          error: err.message || "Failed to connect to node",
        };
      }
    }),
  );

  // 7. Create pipeline version
  const version = await createVersion(
    pipelineId,
    configYaml,
    userId,
    configWritten
      ? `Deployed config to ${configPath}`
      : `Config validated, version created (no VECTOR_CONFIG_DIR set)`,
  );

  return {
    success: true,
    versionId: version.id,
    versionNumber: version.version,
    nodeResults,
    configWritten,
    configPath,
  };
}
