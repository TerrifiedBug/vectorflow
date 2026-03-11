// src/lib/ai/prompts.ts

import { buildVrlReferenceFromRegistry } from "@/lib/vrl/function-registry";

export function buildVrlSystemPrompt(context: {
  fields?: { name: string; type: string }[];
  currentCode?: string;
  componentType?: string;
  sourceTypes?: string[];
}): string {
  const parts: string[] = [
    "You are a VRL (Vector Remap Language) code assistant for Vector data pipelines.",
    "Generate VRL code based on the user's request. Output ONLY the VRL code — no explanations, no markdown fencing, no comments unless the user asks for them.",
    "",
    "=== VRL Function Reference ===",
    buildVrlReferenceFromRegistry(),
  ];

  if (context.sourceTypes?.length) {
    parts.push("", `Connected source types: ${context.sourceTypes.join(", ")}`);
  }

  if (context.componentType) {
    parts.push(`Transform component type: ${context.componentType}`);
  }

  if (context.fields?.length) {
    parts.push("", "Available fields in the event:");
    for (const f of context.fields) {
      parts.push(`  .${f.name} (${f.type})`);
    }
  }

  if (context.currentCode?.trim()) {
    parts.push("", "Current VRL code in the editor:", "```", context.currentCode, "```");
  }

  return parts.join("\n");
}

export function buildVrlChatSystemPrompt(context: {
  fields?: { name: string; type: string }[];
  currentCode?: string;
  componentType?: string;
  sourceTypes?: string[];
}): string {
  const parts: string[] = [
    "You are a VRL (Vector Remap Language) assistant for Vector data pipelines.",
    "Analyze the user's VRL code and requests. Return your response as a JSON object.",
    "",
    "Response format (return ONLY this JSON, no markdown fencing, no extra text):",
    JSON.stringify({
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
    }, null, 2),
    "",
    "Suggestion types:",
    '- insert_code: Adds new VRL code. Set targetCode to null.',
    '- replace_code: Replaces existing VRL. Set targetCode to the EXACT existing code to find and replace.',
    '- remove_code: Removes existing VRL. Set targetCode to the EXACT existing code to remove. Set code to empty string.',
    "",
    "Rules:",
    "- Each suggestion needs a unique id (s1, s2, s3...)",
    "- For replace_code/remove_code, targetCode MUST be an exact substring of the current VRL code",
    "- Focus on: correctness, performance, readability, best practices",
    "- Prioritize: high = bug or data loss risk, medium = optimization, low = cleanup",
    "- Return valid JSON only. No markdown, no code fences, no commentary outside the JSON.",
    "- Even in follow-up messages, always return the full JSON object.",
    "- If the user asks a question that doesn't need code changes, return an empty suggestions array with your answer in the summary.",
    "",
    "=== VRL Function Reference ===",
    buildVrlReferenceFromRegistry(),
  ];

  if (context.sourceTypes?.length) {
    parts.push("", `Connected source types: ${context.sourceTypes.join(", ")}`);
  }

  if (context.componentType) {
    parts.push(`Transform component type: ${context.componentType}`);
  }

  if (context.fields?.length) {
    parts.push("", "Available fields in the event:");
    for (const f of context.fields) {
      parts.push(`  .${f.name} (${f.type})`);
    }
  }

  if (context.currentCode?.trim()) {
    parts.push("", "Current VRL code in the editor:", "```", context.currentCode, "```");
  }

  return parts.join("\n");
}

export function buildPipelineSystemPrompt(context: {
  mode: "generate" | "review";
  currentYaml?: string;
  componentTypes?: string[];
  environmentName?: string;
}): string {
  const parts: string[] = [];

  if (context.mode === "generate") {
    parts.push(
      "You are a Vector pipeline generator.",
      "Generate a valid Vector YAML configuration with sources, transforms, and/or sinks sections based on the user's description.",
      "Output ONLY valid Vector YAML — no explanations, no markdown fencing.",
      "",
      "Rules:",
      "- Use descriptive component keys (e.g., kafka_source, parse_logs, datadog_sink)",
      "- Connect components via the `inputs` field in transforms and sinks",
      "- Use realistic default values for ports, endpoints, etc.",
      '- For sensitive values use placeholder format: "${ENV_VAR_NAME}"',
    );
  } else {
    parts.push(
      "You are a Vector pipeline configuration reviewer.",
      "Analyze the provided Vector pipeline YAML and return your response as a JSON object.",
      "",
      "Response format (return ONLY this JSON, no markdown fencing, no extra text):",
      JSON.stringify({
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
      }, null, 2),
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
      "- componentKey values MUST match real keys from the provided YAML",
      "- When fixing VRL code (source field of remap transforms), ALWAYS use modify_vrl with the exact targetCode to replace. Never use modify_config to overwrite entire VRL scripts.",
      "- Focus on: performance, correctness, best practices, potential issues",
      "- Prioritize: high = likely bug or major perf issue, medium = optimization, low = cleanup",
      "- Return valid JSON only. No markdown, no code fences, no commentary outside the JSON.",
      "- Even in follow-up messages, always return the full JSON object. Never mix prose with JSON.",
    );
  }

  if (context.environmentName) {
    parts.push("", `Environment: ${context.environmentName}`);
  }

  if (context.currentYaml?.trim()) {
    parts.push("", "Current pipeline configuration:", "```yaml", context.currentYaml, "```");
  }

  return parts.join("\n");
}
