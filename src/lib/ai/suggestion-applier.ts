// src/lib/ai/suggestion-applier.ts
import type { Node, Edge } from "@xyflow/react";
import type { AiSuggestion } from "./types";
import { findComponentDef } from "@/lib/vector/catalog";
import { generateComponentKey } from "@/lib/component-key";
import { generateId } from "@/lib/utils";

interface ApplyResult {
  nodes: Node[];
  edges: Edge[];
  error?: string;
}

/**
 * Apply a single suggestion to the current flow state.
 * Returns new nodes/edges arrays (immutable).
 */
export function applySuggestion(
  suggestion: AiSuggestion,
  nodes: Node[],
  edges: Edge[],
): ApplyResult {
  switch (suggestion.type) {
    case "modify_config":
      return applyModifyConfig(suggestion, nodes, edges);
    case "add_component":
      return applyAddComponent(suggestion, nodes, edges);
    case "remove_component":
      return applyRemoveComponent(suggestion, nodes, edges);
    case "modify_connections":
      return applyModifyConnections(suggestion, nodes, edges);
    case "modify_vrl":
      return applyModifyVrl(suggestion, nodes, edges);
    default:
      return { nodes, edges, error: "Unknown suggestion type" };
  }
}

function findNodeByComponentKey(nodes: Node[], componentKey: string): Node | undefined {
  return nodes.find((n) => (n.data as Record<string, unknown>).componentKey === componentKey);
}

/** Deep-set a value at a dot-notation path, returning a shallow-cloned object tree. */
function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  if (!path.includes(".")) {
    return { ...obj, [path]: value };
  }
  const [head, ...rest] = path.split(".");
  const child = (obj[head] ?? {}) as Record<string, unknown>;
  return { ...obj, [head]: setAtPath(child, rest.join("."), value) };
}

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

function applyModifyConfig(
  suggestion: AiSuggestion & { type: "modify_config" },
  nodes: Node[],
  edges: Edge[],
): ApplyResult {
  const target = findNodeByComponentKey(nodes, suggestion.componentKey);
  if (!target) {
    return { nodes, edges, error: `Component "${suggestion.componentKey}" not found` };
  }

  const existingConfig = (target.data as Record<string, unknown>).config as Record<string, unknown>;
  let newConfig = { ...existingConfig };
  for (const [key, value] of Object.entries(suggestion.changes)) {
    newConfig = setAtPath(newConfig, key, value);
  }

  const newNodes = nodes.map((n) =>
    n.id === target.id
      ? { ...n, data: { ...n.data, config: newConfig } }
      : n,
  );

  return { nodes: newNodes, edges };
}

function applyAddComponent(
  suggestion: AiSuggestion & { type: "add_component" },
  nodes: Node[],
  edges: Edge[],
): ApplyResult {
  const { component, insertAfter, connectTo } = suggestion;

  const componentDef = findComponentDef(component.componentType, component.kind);
  if (!componentDef) {
    return { nodes, edges, error: `Unknown component type "${component.componentType}"` };
  }

  const afterNode = findNodeByComponentKey(nodes, insertAfter);
  if (!afterNode) {
    return { nodes, edges, error: `Component "${insertAfter}" not found for insertAfter` };
  }

  const position = {
    x: afterNode.position.x,
    y: afterNode.position.y + 150,
  };

  const newNodeId = generateId();
  const newComponentKey = generateComponentKey(component.componentType);

  const newNode: Node = {
    id: newNodeId,
    type: component.kind,
    position,
    data: {
      componentDef,
      componentKey: newComponentKey,
      displayName: componentDef.displayName,
      config: component.config,
    },
  };

  let newEdges = [...edges];

  // Add edge: afterNode to newNode (once, regardless of connectTo count)
  newEdges.push({ id: generateId(), source: afterNode.id, target: newNodeId });

  for (const downstreamKey of connectTo) {
    const downstreamNode = findNodeByComponentKey(nodes, downstreamKey);
    if (!downstreamNode) continue;

    // Remove existing edge from afterNode to downstream
    newEdges = newEdges.filter(
      (e) => !(e.source === afterNode.id && e.target === downstreamNode.id),
    );

    // Add edge: newNode to downstream
    newEdges.push({ id: generateId(), source: newNodeId, target: downstreamNode.id });
  }

  return { nodes: [...nodes, newNode], edges: newEdges };
}

function applyRemoveComponent(
  suggestion: AiSuggestion & { type: "remove_component" },
  nodes: Node[],
  edges: Edge[],
): ApplyResult {
  const target = findNodeByComponentKey(nodes, suggestion.componentKey);
  if (!target) {
    return { nodes, edges, error: `Component "${suggestion.componentKey}" not found` };
  }

  if ((target.data as Record<string, unknown>).isSystemLocked) {
    return { nodes, edges, error: `Component "${suggestion.componentKey}" is system-locked` };
  }

  const incomingEdges = edges.filter((e) => e.target === target.id);
  const outgoingEdges = edges.filter((e) => e.source === target.id);

  const newEdges = edges.filter((e) => e.source !== target.id && e.target !== target.id);
  const newNodes = nodes.filter((n) => n.id !== target.id);

  if (suggestion.reconnect) {
    for (const incoming of incomingEdges) {
      for (const outgoing of outgoingEdges) {
        newEdges.push({
          id: generateId(),
          source: incoming.source,
          target: outgoing.target,
        });
      }
    }
  }

  return { nodes: newNodes, edges: newEdges };
}

function applyModifyConnections(
  suggestion: AiSuggestion & { type: "modify_connections" },
  nodes: Node[],
  edges: Edge[],
): ApplyResult {
  let newEdges = [...edges];

  for (const change of suggestion.edgeChanges) {
    const fromNode = findNodeByComponentKey(nodes, change.from);
    const toNode = findNodeByComponentKey(nodes, change.to);

    if (!fromNode || !toNode) {
      return {
        nodes,
        edges,
        error: `Component "${!fromNode ? change.from : change.to}" not found`,
      };
    }

    if (change.action === "add") {
      const exists = newEdges.some(
        (e) => e.source === fromNode.id && e.target === toNode.id,
      );
      if (!exists) {
        newEdges.push({ id: generateId(), source: fromNode.id, target: toNode.id });
      }
    } else {
      newEdges = newEdges.filter(
        (e) => !(e.source === fromNode.id && e.target === toNode.id),
      );
    }
  }

  return { nodes, edges: newEdges };
}

function applyModifyVrl(
  suggestion: AiSuggestion & { type: "modify_vrl" },
  nodes: Node[],
  edges: Edge[],
): ApplyResult {
  const target = findNodeByComponentKey(nodes, suggestion.componentKey);
  if (!target) {
    return { nodes, edges, error: `Component "${suggestion.componentKey}" not found` };
  }

  const existingConfig = (target.data as Record<string, unknown>).config as Record<string, unknown>;
  const currentValue = getAtPath(existingConfig, suggestion.configPath);

  if (typeof currentValue !== "string") {
    return { nodes, edges, error: `Config path "${suggestion.configPath}" is not a string value` };
  }

  if (!currentValue.includes(suggestion.targetCode)) {
    return { nodes, edges, error: `Target code not found in "${suggestion.configPath}" — code may have changed` };
  }

  const newValue = currentValue.replaceAll(suggestion.targetCode, suggestion.code);
  const newConfig = setAtPath(existingConfig, suggestion.configPath, newValue);

  const newNodes = nodes.map((n) =>
    n.id === target.id
      ? { ...n, data: { ...n.data, config: newConfig } }
      : n,
  );

  return { nodes: newNodes, edges };
}
