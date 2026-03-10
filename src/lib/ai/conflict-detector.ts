// src/lib/ai/conflict-detector.ts
import type { AiSuggestion } from "./types";

export interface ConflictPair {
  a: string;
  b: string;
  reason: string;
}

/**
 * Detect conflicts between selected suggestions.
 * Returns pairs of conflicting suggestion IDs with reasons.
 */
export function detectConflicts(suggestions: AiSuggestion[]): ConflictPair[] {
  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < suggestions.length; i++) {
    for (let j = i + 1; j < suggestions.length; j++) {
      const conflict = checkPairConflict(suggestions[i], suggestions[j]);
      if (conflict) {
        conflicts.push({ a: suggestions[i].id, b: suggestions[j].id, reason: conflict });
      }
    }
  }

  return conflicts;
}

function checkPairConflict(a: AiSuggestion, b: AiSuggestion): string | null {
  // Same-type: two modify_config on same component with overlapping keys
  if (a.type === "modify_config" && b.type === "modify_config") {
    if (a.componentKey === b.componentKey) {
      const keysA = Object.keys(a.changes);
      const keysB = Object.keys(b.changes);
      const overlap = keysA.filter((k) => keysB.includes(k));
      if (overlap.length > 0) {
        return `Both modify "${a.componentKey}" config keys: ${overlap.join(", ")}`;
      }
    }
  }

  // Same-type: contradicting modify_connections
  if (a.type === "modify_connections" && b.type === "modify_connections") {
    for (const ea of a.edgeChanges) {
      for (const eb of b.edgeChanges) {
        if (ea.from === eb.from && ea.to === eb.to) {
          if (ea.action !== eb.action) {
            return `Contradicting edge changes: ${ea.from} to ${ea.to}`;
          }
          if (ea.action === "add" && eb.action === "add") {
            return `Duplicate edge addition: ${ea.from} to ${ea.to}`;
          }
        }
      }
    }
  }

  // Cross-type: remove_component vs anything referencing that component
  if (a.type === "remove_component" || b.type === "remove_component") {
    const remover = (a.type === "remove_component" ? a : b) as AiSuggestion & { type: "remove_component" };
    const other = a.type === "remove_component" ? b : a;
    const removedKey = remover.componentKey;
    const referencedKeys = getReferencedComponentKeys(other);
    if (referencedKeys.has(removedKey)) {
      return `"${removedKey}" is removed by one suggestion but referenced by another`;
    }
  }

  // Cross-type: add_component connectTo vs modify_connections removing same edge
  if (
    (a.type === "add_component" && b.type === "modify_connections") ||
    (a.type === "modify_connections" && b.type === "add_component")
  ) {
    const adder = a.type === "add_component" ? a : b as AiSuggestion & { type: "add_component" };
    const modifier = a.type === "modify_connections" ? a : b as AiSuggestion & { type: "modify_connections" };
    for (const edge of modifier.edgeChanges) {
      if (edge.action === "remove" && adder.connectTo.includes(edge.to)) {
        return `add_component connects to "${edge.to}" but modify_connections removes an edge to it`;
      }
    }
  }

  return null;
}

function getReferencedComponentKeys(s: AiSuggestion): Set<string> {
  const keys = new Set<string>();
  switch (s.type) {
    case "modify_config":
      keys.add(s.componentKey);
      break;
    case "add_component":
      keys.add(s.insertAfter);
      for (const k of s.connectTo) keys.add(k);
      break;
    case "remove_component":
      keys.add(s.componentKey);
      break;
    case "modify_connections":
      for (const e of s.edgeChanges) {
        keys.add(e.from);
        keys.add(e.to);
      }
      break;
  }
  return keys;
}
