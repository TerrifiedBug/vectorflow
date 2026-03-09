import yaml from "js-yaml";
import type { Node, Edge } from "@xyflow/react";

/** Shape of node.data used by the flow editor */
interface FlowNodeData {
  componentDef: { type: string; kind: string };
  componentKey: string;
  config: Record<string, unknown>;
  disabled?: boolean;
}

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
  enrichment?: { environmentName: string; pipelineVersion: number } | null,
): string {
  // Filter out disabled nodes and their edges
  const enabledNodes = nodes.filter((n) => !(n.data as unknown as FlowNodeData).disabled);
  const enabledNodeIds = new Set(enabledNodes.map((n) => n.id));
  const enabledEdges = edges.filter(
    (e) => enabledNodeIds.has(e.source) && enabledNodeIds.has(e.target),
  );

  // Separate Vector-external keys from real config sections
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { log_level: _logLevel, ...vectorGlobalConfig } = globalConfig ?? {};

  const config: Record<string, Record<string, unknown>> = {
    // Inject global config sections first (api, enrichment_tables, etc.)
    ...(vectorGlobalConfig as Record<string, Record<string, unknown>>),
    sources: {},
    transforms: {},
    sinks: {},
  };

  // Group nodes by kind
  for (const node of enabledNodes) {
    const { componentDef, componentKey, config: nodeConfig } = node.data as unknown as FlowNodeData;
    const section =
      componentDef.kind === "source"
        ? "sources"
        : componentDef.kind === "transform"
          ? "transforms"
          : "sinks";

    const entry: Record<string, unknown> = {
      type: componentDef.type,
      ...nodeConfig,
    };

    // Strip nested objects opted-out via strategy="none", or empty (all null/"")
    for (const [key, val] of Object.entries(entry)) {
      if (val != null && typeof val === "object" && !Array.isArray(val)) {
        const obj = val as Record<string, unknown>;
        if (
          obj.strategy === "none" ||
          Object.values(obj).every((v) => v == null || v === "")
        ) {
          delete entry[key];
        }
      }
    }

    // For transforms and sinks, build inputs array from incoming edges
    if (componentDef.kind !== "source") {
      const inputs = enabledEdges
        .filter((e) => e.target === node.id)
        .map((e) => {
          const sourceNode = enabledNodes.find((n) => n.id === e.source);
          return sourceNode ? (sourceNode.data as unknown as FlowNodeData).componentKey : null;
        })
        .filter(Boolean);
      if (inputs.length > 0) {
        entry.inputs = inputs;
      }
    }

    config[section][componentKey] = entry;
  }

  // Inject a per-sink metadata enrichment transform to preserve topology
  if (enrichment) {
    const sinkKeys = Object.keys(config.sinks ?? {});
    const vrl = `.vectorflow.environment = ${JSON.stringify(enrichment.environmentName.toLowerCase())}\n.vectorflow.pipeline_version = ${enrichment.pipelineVersion}\n.vectorflow.host = get_hostname!()`;

    for (const sinkKey of sinkKeys) {
      const sink = config.sinks[sinkKey] as Record<string, unknown>;
      const sinkInputs = sink.inputs as string[] | undefined;
      if (sinkInputs && sinkInputs.length > 0) {
        const enrichKey = `vectorflow_enrich_${sinkKey}`;
        config.transforms[enrichKey] = {
          type: "remap",
          inputs: [...sinkInputs],
          source: vrl,
        };
        sink.inputs = [enrichKey];
      }
    }
  }

  // Remove empty sections
  for (const key of Object.keys(config)) {
    if (Object.keys(config[key]).length === 0) {
      delete config[key];
    }
  }

  return yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });
}
