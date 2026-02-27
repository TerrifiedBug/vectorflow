import { writeFile } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { createVersion } from "@/server/services/pipeline-version";
import {
  cloneRepo,
  commitAndPush,
  type GitConfig,
} from "@/server/integrations/git-client";

export interface GitOpsDeployResult {
  success: boolean;
  commitHash?: string;
  versionId?: string;
  versionNumber?: number;
  error?: string;
  validationErrors?: Array<{ message: string; componentKey?: string }>;
}

/**
 * Deploy a pipeline via GitOps. Generates the YAML config, commits it
 * to the configured git repository, and pushes to the target branch.
 * A CD system (e.g. ArgoCD, Flux) is then expected to pick up the change.
 */
export async function deployGitOps(
  pipelineId: string,
  environmentId: string,
  userId: string,
  gitConfig: GitConfig,
): Promise<GitOpsDeployResult> {
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

  // 2. Generate and validate YAML
  const configYaml = generateVectorYaml(flowNodes as any, flowEdges as any);

  const validation = await validateConfig(configYaml);
  if (!validation.valid) {
    return {
      success: false,
      validationErrors: validation.errors,
    };
  }

  // 3. Clone/pull the git repo
  let workspace;
  try {
    workspace = await cloneRepo(gitConfig);
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to clone repository: ${err.message}`,
    };
  }

  try {
    // 4. Write YAML to config path in the repo
    const configFileName = `vector-${pipeline.name.toLowerCase().replace(/\s+/g, "-")}.yaml`;
    const configPath = join(workspace.dir, configFileName);
    await writeFile(configPath, configYaml, "utf-8");

    // 5. Commit with descriptive message
    const commitMessage = [
      `deploy: update ${pipeline.name} pipeline config`,
      "",
      `Pipeline: ${pipeline.name} (${pipelineId})`,
      `Environment: ${environmentId}`,
      `Deployed by VectorFlow`,
    ].join("\n");

    const commitHash = await commitAndPush(
      workspace,
      configFileName,
      commitMessage,
      gitConfig.branch,
    );

    // 6. Create pipeline version + audit log
    const version = await createVersion(
      pipelineId,
      configYaml,
      userId,
      `Deployed via GitOps to ${gitConfig.branch} (${commitHash.slice(0, 8)})`,
    );

    await prisma.auditLog.create({
      data: {
        userId,
        action: "DEPLOY_GITOPS",
        entityType: "Pipeline",
        entityId: pipelineId,
        metadata: {
          environmentId,
          success: true,
          commitHash,
          branch: gitConfig.branch,
          repoUrl: gitConfig.repoUrl,
          versionId: version.id,
        },
      },
    });

    return {
      success: true,
      commitHash,
      versionId: version.id,
      versionNumber: version.version,
    };
  } catch (err: any) {
    // Log failed attempt
    await prisma.auditLog.create({
      data: {
        userId,
        action: "DEPLOY_GITOPS",
        entityType: "Pipeline",
        entityId: pipelineId,
        metadata: {
          environmentId,
          success: false,
          error: err.message,
          branch: gitConfig.branch,
          repoUrl: gitConfig.repoUrl,
        },
      },
    });

    return {
      success: false,
      error: `GitOps deploy failed: ${err.message}`,
    };
  } finally {
    await workspace.cleanup();
  }
}
