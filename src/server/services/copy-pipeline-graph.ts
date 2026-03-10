import type { Prisma } from "@/generated/prisma";

type Tx = Prisma.TransactionClient;

interface CopyPipelineGraphOptions {
  sourcePipelineId: string;
  targetPipelineId: string;
  transformConfig?: (
    config: Record<string, unknown>,
    componentKey: string,
  ) => Record<string, unknown>;
  /** When true, shared component links are stripped (e.g. cross-environment promote). */
  stripSharedComponentLinks?: boolean;
}

/**
 * Copy all nodes and edges from one pipeline to another inside an
 * existing Prisma transaction.  Node IDs are remapped so edges point
 * to the newly created nodes.
 *
 * An optional `transformConfig` callback can be supplied to mutate
 * each node's config during the copy (e.g. stripping secret refs
 * when promoting across environments).
 */
export async function copyPipelineGraph(
  tx: Tx,
  opts: CopyPipelineGraphOptions,
) {
  const { sourcePipelineId, targetPipelineId, transformConfig, stripSharedComponentLinks } = opts;

  const sourceNodes = await tx.pipelineNode.findMany({
    where: { pipelineId: sourcePipelineId },
  });

  const sourceEdges = await tx.pipelineEdge.findMany({
    where: { pipelineId: sourcePipelineId },
  });

  // Build old -> new node ID mapping
  const nodeIdMap = new Map<string, string>();

  for (const node of sourceNodes) {
    const config = (node.config ?? {}) as Record<string, unknown>;
    const finalConfig = transformConfig
      ? transformConfig(config, node.componentKey)
      : config;

    const created = await tx.pipelineNode.create({
      data: {
        pipelineId: targetPipelineId,
        componentKey: node.componentKey,
        componentType: node.componentType,
        kind: node.kind,
        config: finalConfig as Prisma.InputJsonValue,
        positionX: node.positionX,
        positionY: node.positionY,
        disabled: node.disabled,
        sharedComponentId: stripSharedComponentLinks ? null : (node.sharedComponentId ?? null),
        sharedComponentVersion: stripSharedComponentLinks ? null : (node.sharedComponentVersion ?? null),
      },
    });

    nodeIdMap.set(node.id, created.id);
  }

  // Copy edges, remapping source/target to new node IDs
  for (const edge of sourceEdges) {
    const newSource = nodeIdMap.get(edge.sourceNodeId);
    const newTarget = nodeIdMap.get(edge.targetNodeId);
    if (newSource && newTarget) {
      await tx.pipelineEdge.create({
        data: {
          pipelineId: targetPipelineId,
          sourceNodeId: newSource,
          targetNodeId: newTarget,
          sourcePort: edge.sourcePort,
        },
      });
    }
  }
}
