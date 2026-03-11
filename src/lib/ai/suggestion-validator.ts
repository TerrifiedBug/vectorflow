// src/lib/ai/suggestion-validator.ts
import type { Node } from "@xyflow/react";
import type { AiSuggestion, AiReviewResponse, SuggestionStatus } from "./types";

/** Strip markdown code fences and extract the JSON body. */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Validate a parsed AI response. Returns the response if valid, null if not.
 */
export function parseAiReviewResponse(raw: string): AiReviewResponse | null {
  try {
    const parsed = JSON.parse(stripCodeFences(raw));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.suggestions)
    ) {
      return parsed as AiReviewResponse;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that suggestion references exist on the canvas.
 */
export function validateSuggestions(
  suggestions: AiSuggestion[],
  nodes: Node[],
): Map<string, SuggestionStatus> {
  const componentKeys = new Set(
    nodes.map((n) => (n.data as Record<string, unknown>).componentKey as string),
  );

  const statuses = new Map<string, SuggestionStatus>();

  for (const s of suggestions) {
    const referencedKeys = getReferencedKeys(s);
    const allValid = referencedKeys.every((k) => componentKeys.has(k));
    statuses.set(s.id, allValid ? "actionable" : "invalid");
  }

  return statuses;
}

/**
 * Determine which suggestions are outdated by comparing pipeline YAML snapshots.
 */
export function detectOutdatedSuggestions(
  suggestions: AiSuggestion[],
  snapshotYaml: string | null,
  currentYaml: string,
): Set<string> {
  if (!snapshotYaml || snapshotYaml === currentYaml) {
    return new Set();
  }

  const outdated = new Set<string>();

  for (const s of suggestions) {
    const keys = getReferencedKeys(s);
    for (const key of keys) {
      const snapshotBlock = extractComponentBlock(snapshotYaml, key);
      const currentBlock = extractComponentBlock(currentYaml, key);
      if (snapshotBlock !== currentBlock) {
        outdated.add(s.id);
        break;
      }
    }
  }

  return outdated;
}

function getReferencedKeys(s: AiSuggestion): string[] {
  switch (s.type) {
    case "modify_config":
      return [s.componentKey];
    case "add_component":
      return [s.insertAfter, ...s.connectTo];
    case "remove_component":
      return [s.componentKey];
    case "modify_connections":
      return s.edgeChanges.flatMap((e) => [e.from, e.to]);
    case "modify_vrl":
      return [s.componentKey];
  }
}

function extractComponentBlock(yaml: string, componentKey: string): string | null {
  const escaped = componentKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^  ${escaped}:\\s*$`, "m");
  const match = regex.exec(yaml);
  if (!match) return null;

  const start = match.index;
  const rest = yaml.slice(start + match[0].length);
  const nextKey = rest.search(/^\s{2}\S/m);
  const end = nextKey === -1 ? yaml.length : start + match[0].length + nextKey;

  return yaml.slice(start, end).trim();
}
