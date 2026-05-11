import { prisma } from "@/lib/prisma";
import { generateVectorYaml } from "@/lib/config-generator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { isDemoMode } from "@/lib/is-demo-mode";
import { infoLog, errorLog } from "@/lib/logger";

/**
 * In hosted demo mode the seed SQL marks pipelines as `isDraft=false` with a
 * `deployedAt` timestamp but cannot create the matching `PipelineVersion`
 * row — that needs `generateVectorYaml`, which only exists in TypeScript.
 * Without a version whose `configYaml` matches the current graph, the
 * `pipeline.get` endpoint reports `hasConfigChanges=true` and the editor
 * shows a permanent "Saved draft pending deploy" banner over pipelines
 * the demo intends to present as live.
 *
 * On startup, regenerate the YAML for every demo pipeline that is missing a
 * version and insert one. Idempotent: re-running this is a no-op once each
 * pipeline has at least one PipelineVersion.
 */
export async function bootstrapDemoDeployments(): Promise<void> {
  if (!isDemoMode()) return;

  const pipelines = await prisma.pipeline.findMany({
    where: {
      isDraft: false,
      deployedAt: { not: null },
      versions: { none: {} },
    },
    include: {
      nodes: true,
      edges: true,
      environment: { select: { name: true } },
    },
  });

  if (pipelines.length === 0) return;

  let synthesised = 0;
  for (const pipeline of pipelines) {
    try {
      const decryptedNodes = pipeline.nodes.map((n) => ({
        ...n,
        config: decryptNodeConfig(
          n.componentType,
          (n.config as Record<string, unknown>) ?? {},
        ),
      }));

      const flowNodes = decryptedNodes.map((n) => ({
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
      const flowEdges = pipeline.edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
      }));

      const enrichment = pipeline.enrichMetadata
        ? { environmentName: pipeline.environment.name, pipelineVersion: 1 }
        : null;
      const yaml = generateVectorYaml(
        flowNodes as Parameters<typeof generateVectorYaml>[0],
        flowEdges as Parameters<typeof generateVectorYaml>[1],
        pipeline.globalConfig as Record<string, unknown> | null,
        enrichment,
      );

      await prisma.pipelineVersion.create({
        data: {
          pipelineId: pipeline.id,
          version: 1,
          configYaml: yaml,
          logLevel:
            (pipeline.globalConfig as Record<string, unknown> | null)?.log_level as string | null ??
            null,
          globalConfig: pipeline.globalConfig ?? undefined,
          changelog: "Demo seed bootstrap — synthesised initial version to match current graph",
        },
      });
      synthesised += 1;
    } catch (err) {
      errorLog(
        "demo-bootstrap",
        `Failed to synthesise PipelineVersion for ${pipeline.id} (${pipeline.name})`,
        err,
      );
    }
  }

  infoLog(
    "demo-bootstrap",
    `Synthesised ${synthesised}/${pipelines.length} PipelineVersion rows for demo-deployed pipelines`,
  );
}
