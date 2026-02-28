import yaml from "js-yaml";
import type { Node, Edge } from "@xyflow/react";
import { findComponentDef } from "@/lib/vector/catalog";
import Dagre from "@dagrejs/dagre";

/**
 * Parse a Vector YAML (or TOML — YAML-only for now) config string and
 * return React Flow nodes + edges with auto-layout positions via dagre.
 *
 * The returned nodes carry `data: { componentDef, componentKey, config }`
 * matching the shape the flow store expects.
 */
export function importVectorConfig(
  content: string,
  format: "yaml" | "toml" = "yaml",
): { nodes: Node[]; edges: Edge[] } {
  // Currently only YAML is fully supported; TOML parsing could be added
  // later with a TOML library.
  const config = yaml.load(content) as Record<string, any>;

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeMap = new Map<string, string>(); // componentKey -> nodeId

  const sections: Array<[string, "source" | "transform" | "sink"]> = [
    ["sources", "source"],
    ["transforms", "transform"],
    ["sinks", "sink"],
  ];

  for (const [section, kind] of sections) {
    const components = (config[section] ?? {}) as Record<string, any>;

    for (const [key, value] of Object.entries(components)) {
      const componentType: string = value.type || key;

      // Try to resolve against the catalog; fall back to a minimal definition
      const componentDef = findComponentDef(componentType, kind) ?? {
        type: componentType,
        kind,
        displayName: componentType,
        description: "",
        category: "Unknown",
        outputTypes: ["log"] as const,
        configSchema: { type: "object" as const, properties: {} },
      };

      // Strip `type` and `inputs` — they are structural, not user config
      const { type: _type, inputs: _inputs, ...nodeConfig } = value;

      const nodeId = crypto.randomUUID();
      nodeMap.set(key, nodeId);

      nodes.push({
        id: nodeId,
        type: kind,
        position: { x: 0, y: 0 }, // will be overwritten by dagre
        data: { componentDef, componentKey: key, config: nodeConfig },
      });

      // Collect edges (source field is a componentKey for now; resolved below)
      if (value.inputs) {
        const inputList: string[] = Array.isArray(value.inputs)
          ? value.inputs
          : [value.inputs];

        for (const input of inputList) {
          edges.push({
            id: crypto.randomUUID(),
            source: input, // temporary — componentKey, resolved after all nodes parsed
            target: nodeId,
          });
        }
      }
    }
  }

  // Resolve edge sources from componentKey to nodeId
  for (const edge of edges) {
    const resolvedSource = nodeMap.get(edge.source);
    if (resolvedSource) {
      edge.source = resolvedSource;
    }
  }

  // ── Auto-layout with dagre ────────────────────────────────────────────
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 80, ranksep: 150 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 250, height: 120 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  for (const node of nodes) {
    const pos = g.node(node.id);
    node.position = { x: pos.x - 125, y: pos.y - 60 };
  }

  return { nodes, edges };
}
