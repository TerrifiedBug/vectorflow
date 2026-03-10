// src/lib/ai/prompts.ts

import { VRL_REFERENCE } from "./vrl-reference";

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
    VRL_REFERENCE,
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
      "Analyze the provided Vector pipeline YAML and provide improvement suggestions.",
      "Focus on: performance, correctness, best practices, and potential issues.",
      "If the user asks for a revised config, output the complete corrected YAML with no markdown fencing.",
      "Otherwise, provide suggestions as concise text.",
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
