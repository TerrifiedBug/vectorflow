import type { Node, Edge } from "@xyflow/react";

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
export function generateVectorToml(nodes: Node[], edges: Edge[]): string {
  const config: Record<string, Record<string, any>> = {
    sources: {},
    transforms: {},
    sinks: {},
  };

  for (const node of nodes) {
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

    if (componentDef.kind !== "source") {
      const inputs = edges
        .filter((e) => e.target === node.id)
        .map((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode ? (sourceNode.data as any).componentKey : null;
        })
        .filter(Boolean);
      if (inputs.length > 0) {
        entry.inputs = inputs;
      }
    }

    config[section][componentKey] = entry;
  }

  const lines: string[] = [];

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
  // Use basic strings — escape backslashes and double quotes
  const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
