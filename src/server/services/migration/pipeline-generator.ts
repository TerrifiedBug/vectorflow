import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { nanoid } from "nanoid";
import type { TranslationResult, TranslatedBlock } from "./types";

const NODE_SPACING_X = 300;
const NODE_SPACING_Y = 200;
const SOURCE_START_X = 100;
const SOURCE_START_Y = 100;

interface GeneratePipelineParams {
  translationResult: TranslationResult;
  environmentId: string;
  pipelineName: string;
  migrationProjectId: string;
}

/**
 * Generate a VectorFlow Pipeline with PipelineNodes and PipelineEdges
 * from a set of translated blocks.
 *
 * Layout:
 * - Sources on the left column
 * - Transforms in the middle column
 * - Sinks on the right column
 * - Vertical spacing between nodes in the same column
 */
export async function generatePipeline(
  params: GeneratePipelineParams,
): Promise<{ id: string }> {
  const { translationResult, environmentId, pipelineName, migrationProjectId } =
    params;

  const successfulBlocks = translationResult.blocks.filter(
    (b) => b.status === "translated",
  );

  if (successfulBlocks.length === 0) {
    throw new Error(
      "No successfully translated blocks to generate a pipeline from.",
    );
  }

  // Compute node positions by kind
  const sources = successfulBlocks.filter((b) => b.kind === "source");
  const transforms = successfulBlocks.filter((b) => b.kind === "transform");
  const sinks = successfulBlocks.filter((b) => b.kind === "sink");

  // Map from componentId to generated node ID
  const componentIdToNodeId = new Map<string, string>();

  // Build nodes with positions
  const pipelineNodes: Array<{
    id: string;
    componentKey: string;
    componentType: string;
    kind: "SOURCE" | "TRANSFORM" | "SINK";
    config: Record<string, unknown>;
    positionX: number;
    positionY: number;
  }> = [];

  const layoutColumn = (
    blocks: TranslatedBlock[],
    columnX: number,
    kind: "SOURCE" | "TRANSFORM" | "SINK",
  ) => {
    blocks.forEach((block, index) => {
      const nodeId = nanoid(12);
      componentIdToNodeId.set(block.componentId, nodeId);

      pipelineNodes.push({
        id: nodeId,
        componentKey: block.componentId,
        componentType: block.componentType,
        kind,
        config: block.config,
        positionX: columnX,
        positionY: SOURCE_START_Y + index * NODE_SPACING_Y,
      });
    });
  };

  layoutColumn(sources, SOURCE_START_X, "SOURCE");
  layoutColumn(transforms, SOURCE_START_X + NODE_SPACING_X, "TRANSFORM");
  layoutColumn(sinks, SOURCE_START_X + NODE_SPACING_X * 2, "SINK");

  // Build edges from inputs references
  const pipelineEdges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourcePort: string | null;
  }> = [];

  for (const block of successfulBlocks) {
    const targetNodeId = componentIdToNodeId.get(block.componentId);
    if (!targetNodeId) continue;

    for (const inputId of block.inputs) {
      const sourceNodeId = componentIdToNodeId.get(inputId);
      if (!sourceNodeId) continue;

      pipelineEdges.push({
        id: nanoid(12),
        sourceNodeId,
        targetNodeId,
        sourcePort: null,
      });
    }
  }

  // If no edges were created (inputs didn't match), create a linear chain
  if (pipelineEdges.length === 0 && pipelineNodes.length > 1) {
    const orderedNodes = [
      ...sources.map((b) => componentIdToNodeId.get(b.componentId)!),
      ...transforms.map((b) => componentIdToNodeId.get(b.componentId)!),
      ...sinks.map((b) => componentIdToNodeId.get(b.componentId)!),
    ].filter(Boolean);

    for (let i = 0; i < orderedNodes.length - 1; i++) {
      pipelineEdges.push({
        id: nanoid(12),
        sourceNodeId: orderedNodes[i],
        targetNodeId: orderedNodes[i + 1],
        sourcePort: null,
      });
    }
  }

  // Create pipeline in database
  const pipeline = await prisma.pipeline.create({
    data: {
      name: pipelineName,
      description: `Migrated from FluentD (project: ${migrationProjectId})`,
      environmentId,
      isDraft: true,
      nodes: {
        create: pipelineNodes.map((n) => ({
          id: n.id,
          componentKey: n.componentKey,
          componentType: n.componentType,
          kind: n.kind,
          config: n.config as unknown as Prisma.InputJsonValue,
          positionX: n.positionX,
          positionY: n.positionY,
        })),
      },
      edges: {
        create: pipelineEdges.map((e) => ({
          id: e.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          sourcePort: e.sourcePort,
        })),
      },
    },
    select: { id: true },
  });

  return pipeline;
}
