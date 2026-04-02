// src/lib/ai/cost-recommendation-prompt.ts

import {
  buildSuggestionSchemaBlock,
  buildVrlReferenceBlock,
  buildPipelineNodeContext,
  buildComponentDocsBlock,
} from "@/lib/ai/shared-prompt-context";

export interface CostRecommendationPromptContext {
  type: string; // "LOW_REDUCTION" | "HIGH_ERROR_RATE" | "STALE_PIPELINE"
  title: string;
  description: string;
  analysisData: Record<string, unknown>;
  suggestedAction: unknown;
  pipelineName: string;
  nodes: Array<{
    componentKey: string;
    componentType: string;
    kind: string;
    config: unknown;
  }>;
}

/**
 * Builds separate system and user prompts for cost recommendation AI enrichment.
 * The system prompt sets the role, response format, and relevant context blocks.
 * The user prompt describes the specific recommendation and requests actionable suggestions.
 */
export function buildCostRecommendationPrompt(ctx: CostRecommendationPromptContext): {
  system: string;
  user: string;
} {
  const hasRemapTransforms = ctx.nodes.some((n) => n.componentType === "remap");
  const includeVrlReference = ctx.type !== "STALE_PIPELINE" && hasRemapTransforms;

  // ─── System Prompt ───────────────────────────────────────────────────────────
  const systemParts: string[] = [
    "You are a data pipeline cost optimization expert for VectorFlow.",
    "Your role is to analyze cost-related issues in Vector data pipelines and generate specific, actionable suggestions — not vague instructions.",
    "",
    buildSuggestionSchemaBlock("pipeline"),
  ];

  if (includeVrlReference) {
    systemParts.push("", "=== VRL Function Reference ===", buildVrlReferenceBlock());
  }

  if (ctx.nodes.length > 0) {
    systemParts.push("", "=== Pipeline Nodes ===", buildPipelineNodeContext(ctx.nodes));

    // Include targeted Vector docs for each unique component type in the pipeline
    const seen = new Set<string>();
    for (const node of ctx.nodes) {
      const key = `${node.kind}:${node.componentType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const docs = buildComponentDocsBlock(node.componentType, node.kind as "source" | "transform" | "sink");
      if (docs) systemParts.push("", docs);
    }
  }

  // ─── User Prompt ─────────────────────────────────────────────────────────────
  const userParts: string[] = [
    `Recommendation type: ${ctx.type}`,
    `Pipeline: ${ctx.pipelineName}`,
    `Title: ${ctx.title}`,
    `Description: ${ctx.description}`,
    "",
    "Analysis data:",
    JSON.stringify(ctx.analysisData, null, 2),
    "",
    "Suggested action hint:",
    JSON.stringify(ctx.suggestedAction, null, 2),
    "",
    "Generate specific pipeline changes to address this cost recommendation.",
  ];

  return {
    system: systemParts.join("\n"),
    user: userParts.join("\n"),
  };
}
