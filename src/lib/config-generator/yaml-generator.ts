import yaml from "js-yaml";
import type { Node, Edge } from "@xyflow/react";

/**
 * Converts a React Flow graph (nodes + edges) into a valid Vector YAML config string.
 *
 * Each node's `data` is expected to carry:
 *   - componentDef  – catalog entry ({ type, kind, ... })
 *   - componentKey  – the user-assigned name (e.g. "my_source")
 *   - config        – field values for the component
 *
 * Transforms and sinks get an `inputs` array built from incoming edges.
 */
export function generateVectorYaml(
  nodes: Node[],
  edges: Edge[],
  globalConfig?: Record<string, unknown> | null,
): string {
  // Filter out disabled nodes and their edges
  const enabledNodes = nodes.filter((n) => !(n.data as any).disabled);
  const enabledNodeIds = new Set(enabledNodes.map((n) => n.id));
  const enabledEdges = edges.filter(
    (e) => enabledNodeIds.has(e.source) && enabledNodeIds.has(e.target),
  );

  // Separate Vector-external keys from real config sections
  const { log_level: _logLevel, ...vectorGlobalConfig } = globalConfig ?? {};

  const config: Record<string, any> = {
    // Inject global config sections first (api, enrichment_tables, etc.)
    ...vectorGlobalConfig,
    sources: {},
    transforms: {},
    sinks: {},
  };

  // Group nodes by kind
  for (const node of enabledNodes) {
    const { componentDef, componentKey, config: nodeConfig } = node.data as any;
    const section =
      componentDef.kind === "source"
        ? "sources"
        : componentDef.kind === "transform"
          ? "transforms"
          : "sinks";

    const entry: Record<string, any> = {
      type: componentDef.type,
      ...nodeConfig,
    };

    // For transforms and sinks, build inputs array from incoming edges
    if (componentDef.kind !== "source") {
      const inputs = enabledEdges
        .filter((e) => e.target === node.id)
        .map((e) => {
          const sourceNode = enabledNodes.find((n) => n.id === e.source);
          return sourceNode ? (sourceNode.data as any).componentKey : null;
        })
        .filter(Boolean);
      if (inputs.length > 0) {
        entry.inputs = inputs;
      }
    }

    config[section][componentKey] = entry;
  }

  // Remove empty sections
  for (const key of Object.keys(config)) {
    if (Object.keys(config[key]).length === 0) {
      delete config[key];
    }
  }

  return yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });
}
