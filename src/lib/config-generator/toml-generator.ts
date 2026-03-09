import type { Node, Edge } from "@xyflow/react";

/** Shape of node.data used by the flow editor */
interface FlowNodeData {
  componentDef: { type: string; kind: string };
  componentKey: string;
  config: Record<string, unknown>;
  disabled?: boolean;
}

/**
 * Converts a React Flow graph (nodes + edges) into a Vector TOML config string.
 *
 * Produces sections like:
 *   [sources.my_source]
 *   type = "file"
 *   ...
 *
 * This is a simple serialiser — it handles strings, numbers, booleans,
 * arrays, and one level of nested objects which covers the vast majority
 * of Vector component configs.
 */
export function generateVectorToml(
  nodes: Node[],
  edges: Edge[],
  globalConfig?: Record<string, unknown> | null,
): string {
  // Filter out disabled nodes and their edges
  const enabledNodes = nodes.filter((n) => !(n.data as unknown as FlowNodeData).disabled);
  const enabledNodeIds = new Set(enabledNodes.map((n) => n.id));
  const enabledEdges = edges.filter(
    (e) => enabledNodeIds.has(e.source) && enabledNodeIds.has(e.target),
  );

  const config: Record<string, Record<string, Record<string, unknown>>> = {
    sources: {},
    transforms: {},
    sinks: {},
  };

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

    // Strip empty nested objects (e.g. auth: {} when no auth is configured)
    for (const [key, val] of Object.entries(entry)) {
      if (
        val != null &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        Object.values(val as Record<string, unknown>).every((v) => v == null || v === "")
      ) {
        delete entry[key];
      }
    }

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

  const lines: string[] = [];

  // Emit global config sections first (api, enrichment_tables, etc.)
  // Skip log_level — it's a VectorFlow UI key, not a valid Vector config field.
  if (globalConfig) {
    for (const [section, value] of Object.entries(globalConfig)) {
      if (section === "log_level") continue;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        lines.push(`[${section}]`);
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
          formatTomlValue(lines, key, val);
        }
        lines.push("");
      } else {
        formatTomlValue(lines, section, value);
      }
    }
  }

  for (const [section, components] of Object.entries(config)) {
    if (Object.keys(components).length === 0) continue;

    for (const [name, fields] of Object.entries(components)) {
      lines.push(`[${section}.${name}]`);

      for (const [key, value] of Object.entries(fields)) {
        formatTomlValue(lines, key, value);
      }

      lines.push(""); // blank line between sections
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// TOML formatting helpers
// ---------------------------------------------------------------------------

function formatTomlValue(lines: string[], key: string, value: unknown): void {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    lines.push(`${key} = ${tomlString(value)}`);
  } else if (typeof value === "number" || typeof value === "boolean") {
    lines.push(`${key} = ${value}`);
  } else if (Array.isArray(value)) {
    lines.push(`${key} = ${tomlArray(value)}`);
  } else if (typeof value === "object") {
    // Nested object — emit as dotted keys (one level deep)
    for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
      formatTomlValue(lines, `${key}.${subKey}`, subValue);
    }
  }
}

function tomlString(s: string): string {
  // Escape backslashes, double quotes, and control characters per TOML spec
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (ch) => {
      return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    });
  return `"${escaped}"`;
}

function tomlArray(arr: unknown[]): string {
  const items = arr.map((item) => {
    if (typeof item === "string") return tomlString(item);
    if (typeof item === "number" || typeof item === "boolean") return String(item);
    // For objects inside arrays fall back to inline table
    if (typeof item === "object" && item !== null) return tomlInlineTable(item as Record<string, unknown>);
    return String(item);
  });
  return `[${items.join(", ")}]`;
}

function tomlInlineTable(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") parts.push(`${k} = ${tomlString(v)}`);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(`${k} = ${v}`);
    else parts.push(`${k} = ${String(v)}`);
  }
  return `{ ${parts.join(", ")} }`;
}
