// src/lib/ai/shared-prompt-context.ts

import { buildVrlReferenceFromRegistry } from "@/lib/vrl/function-registry";
import { buildComponentDocsBlock as _buildComponentDocsBlock } from "@/lib/ai/vector-docs-reference";
export { buildVectorDocsBlock, buildComponentDocsBlock } from "@/lib/ai/vector-docs-reference";

export interface PipelineNode {
  componentKey: string;
  componentType: string;
  kind: string;
  config: unknown;
}

// Memoized VRL reference — built once at module load time since it never changes at runtime.
let _vrlReferenceCache: string | null = null;

/**
 * Returns the VRL function reference block for use in AI prompts.
 * Memoized so the reference is only built once.
 */
export function buildVrlReferenceBlock(): string {
  if (_vrlReferenceCache === null) {
    _vrlReferenceCache = buildVrlReferenceFromRegistry();
  }
  return _vrlReferenceCache;
}

/**
 * Returns the JSON schema block describing AI suggestion response formats.
 *
 * - "pipeline" mode: 5 suggestion types for pipeline review / cost recommendations
 * - "vrl" mode: 3 suggestion types for VRL chat and debug chat
 */
export function buildSuggestionSchemaBlock(mode: "pipeline" | "vrl"): string {
  if (mode === "vrl") {
    const parts: string[] = [
      "Response format (return ONLY this JSON, no markdown fencing, no extra text):",
      JSON.stringify(
        {
          summary: "2-3 sentence analysis or explanation",
          suggestions: [
            {
              id: "s1",
              type: "insert_code",
              title: "Short title",
              description: "What this does and why",
              priority: "high|medium|low",
              code: "the VRL code",
              targetCode: null,
            },
          ],
        },
        null,
        2,
      ),
      "",
      "Suggestion types:",
      "- insert_code: Adds new VRL code. Set targetCode to null.",
      "- replace_code: Replaces existing VRL. Set targetCode to the EXACT existing code to find and replace.",
      "- remove_code: Removes existing VRL. Set targetCode to the EXACT existing code to remove. Set code to empty string.",
      "",
      "Rules:",
      "- Each suggestion needs a unique id (s1, s2, s3...)",
      "- For replace_code/remove_code, targetCode MUST be an exact substring of the current VRL code",
      "- Focus on: correctness, performance, readability, best practices",
      "- Prioritize: high = bug or data loss risk, medium = optimization, low = cleanup",
      "- Return valid JSON only. No markdown, no code fences, no commentary outside the JSON.",
      "- Even in follow-up messages, always return the full JSON object.",
      "- If the user asks a question that doesn't need code changes, return an empty suggestions array with your answer in the summary.",
    ];
    return parts.join("\n");
  }

  // pipeline mode
  const parts: string[] = [
    "Response format (return ONLY this JSON, no markdown fencing, no extra text):",
    JSON.stringify(
      {
        summary: "2-3 sentence analysis of the pipeline",
        suggestions: [
          {
            id: "s1",
            type: "modify_vrl",
            title: "Short title",
            description: "Why this helps",
            priority: "high|medium|low",
            componentKey: "remap_component_key",
            configPath: "source",
            targetCode: "exact code to find",
            code: "replacement code",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Suggestion types:",
    '- modify_config: { type: "modify_config", componentKey, changes: { field: value } } — for non-string config values (booleans, numbers, objects)',
    '- modify_vrl: { type: "modify_vrl", componentKey, configPath: "source", targetCode: "exact lines to find", code: "replacement code" } — for changing VRL/code string fields. targetCode MUST be an exact substring of the current config value.',
    '- add_component: { type: "add_component", component: { key, componentType, kind: "source"|"transform"|"sink", config }, insertAfter: "existing_key", connectTo: ["downstream_key"] }',
    '- remove_component: { type: "remove_component", componentKey, reconnect: true|false }',
    '- modify_connections: { type: "modify_connections", edgeChanges: [{ action: "add"|"remove", from: "key", to: "key" }] }',
    "",
    "Rules:",
    "- Each suggestion needs a unique id (s1, s2, s3...)",
    "- componentKey values MUST match real keys from the provided context",
    "- When fixing VRL code (source field of remap transforms), ALWAYS use modify_vrl with the exact targetCode to replace. Never use modify_config to overwrite entire VRL scripts.",
    "- Focus on: performance, correctness, best practices, potential issues",
    "- Prioritize: high = likely bug or major perf issue, medium = optimization, low = cleanup",
    "- Return valid JSON only. No markdown, no code fences, no commentary outside the JSON.",
    "- Even in follow-up messages, always return the full JSON object. Never mix prose with JSON.",
  ];
  return parts.join("\n");
}

/**
 * Formats an array of pipeline nodes into a context block for AI prompts.
 * For remap transforms, shows the VRL code. For other components, summarizes config keys.
 */
export function buildPipelineNodeContext(nodes: PipelineNode[]): string {
  if (nodes.length === 0) {
    return "No pipeline nodes available.";
  }

  const lines: string[] = [];

  for (const node of nodes) {
    lines.push(`[${node.componentKey}] (${node.kind}: ${node.componentType})`);

    const config = node.config as Record<string, unknown> | null | undefined;

    if (node.componentType === "remap" && config && typeof config.source === "string") {
      lines.push(`  VRL: ${config.source}`);
    } else if (config && typeof config === "object") {
      const keys = Object.keys(config).slice(0, 5);
      if (keys.length > 0) {
        lines.push(`  Config keys: ${keys.join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Builds targeted Vector docs for the unique component types in a pipeline.
 * Only includes docs for components that have a reference entry — adds ~5-10 lines per component.
 */
export function buildPipelineDocsBlock(nodes: PipelineNode[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const node of nodes) {
    const key = `${node.kind}:${node.componentType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const docs = _buildComponentDocsBlock(node.componentType, node.kind as "source" | "transform" | "sink");
    if (docs) parts.push(docs);
  }

  return parts.length > 0 ? ["=== Vector Component Reference ===", ...parts].join("\n\n") : "";
}
