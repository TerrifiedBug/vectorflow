// src/lib/ai/suggestion-diff.ts
import type { Node } from "@xyflow/react";
import type { ChangeObject } from "diff";
import { diffLines } from "diff";
import type { AiSuggestion } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiffResult =
  | { type: "json"; changes: Array<{ key: string; before: unknown; after: unknown }> }
  | { type: "lines"; hunks: ChangeObject<string>[] };

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read a value at a dot-notation path. */
function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function findNodeByComponentKey(nodes: Node[], componentKey: string): Node | undefined {
  return nodes.find((n) => (n.data as Record<string, unknown>).componentKey === componentKey);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute before/after diff data for an AI suggestion against the current flow state.
 *
 * - `modify_config`: returns per-key JSON diffs (before/after values).
 * - `modify_vrl`: returns line-level text diffs via the `diff` package.
 * - Structural types (`add_component`, `remove_component`, `modify_connections`): returns `null`.
 * - Returns `null` when the target node is not found or targetCode is missing.
 */
export function computeSuggestionDiff(
  suggestion: AiSuggestion,
  nodes: Node[],
): DiffResult | null {
  switch (suggestion.type) {
    case "modify_config":
      return computeModifyConfigDiff(suggestion, nodes);
    case "modify_vrl":
      return computeModifyVrlDiff(suggestion, nodes);
    case "add_component":
    case "remove_component":
    case "modify_connections":
      return null;
    default:
      return null;
  }
}

// ─── modify_config diff ─────────────────────────────────────────────────────

function computeModifyConfigDiff(
  suggestion: AiSuggestion & { type: "modify_config" },
  nodes: Node[],
): DiffResult | null {
  const target = findNodeByComponentKey(nodes, suggestion.componentKey);
  if (!target) return null;

  const config = (target.data as Record<string, unknown>).config as Record<string, unknown>;
  const changes: Array<{ key: string; before: unknown; after: unknown }> = [];

  for (const [key, afterValue] of Object.entries(suggestion.changes)) {
    const beforeValue = getAtPath(config, key);
    changes.push({ key, before: beforeValue, after: afterValue });
  }

  return { type: "json", changes };
}

// ─── modify_vrl diff ────────────────────────────────────────────────────────

function computeModifyVrlDiff(
  suggestion: AiSuggestion & { type: "modify_vrl" },
  nodes: Node[],
): DiffResult | null {
  const target = findNodeByComponentKey(nodes, suggestion.componentKey);
  if (!target) return null;

  const config = (target.data as Record<string, unknown>).config as Record<string, unknown>;
  const currentValue = getAtPath(config, suggestion.configPath);

  if (typeof currentValue !== "string") return null;
  if (!currentValue.includes(suggestion.targetCode)) return null;

  const newValue = currentValue.replace(suggestion.targetCode, suggestion.code);
  const hunks = diffLines(currentValue, newValue);

  return { type: "lines", hunks };
}
