"use client";

import type { Node } from "@xyflow/react";

interface SchemaField {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
}

interface InspectorSchemaTabProps {
  node: Node;
}

function formatFieldType(field: SchemaField): string {
  if (Array.isArray(field.type) && field.type.length > 0) {
    return field.type.join(" | ");
  }
  if (typeof field.type === "string" && field.type.length > 0) {
    return field.type;
  }
  if (Array.isArray(field.enum) && field.enum.length > 0) {
    return "enum";
  }
  return "unknown";
}

export function InspectorSchemaTab({ node }: InspectorSchemaTabProps) {
  const componentDef = (node.data as { componentDef?: { configSchema?: unknown } }).componentDef;
  const schema = componentDef?.configSchema as {
    properties?: Record<string, SchemaField>;
    required?: string[];
  } | undefined;
  const fields = Object.entries(schema?.properties ?? {});

  if (fields.length === 0) {
    return (
      <p className="m-3.5 rounded-md border border-dashed border-line-2 px-3 py-6 text-center text-sm text-fg-2">
        No schema fields published for this component.
      </p>
    );
  }

  const required = new Set(schema?.required ?? []);

  return (
    <div className="m-3.5 overflow-hidden rounded-md border">
      <table className="w-full table-fixed text-left text-xs font-mono">
        <thead className="bg-bg-2 text-[10px] uppercase tracking-[0.04em] text-fg-2">
          <tr className="border-b border-line">
            <th className="px-2 py-1.5 font-medium">Field</th>
            <th className="px-2 py-1.5 font-medium">Type</th>
            <th className="px-2 py-1.5 font-medium">Req</th>
            <th className="px-2 py-1.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([name, field]) => (
            <tr key={name} className="border-b border-line last:border-b-0">
              <td className="px-2 py-1.5 align-top text-fg">{name}</td>
              <td className="px-2 py-1.5 align-top text-fg-2">{formatFieldType(field)}</td>
              <td className="px-2 py-1.5 align-top text-fg-2">{required.has(name) ? "yes" : "no"}</td>
              <td className="px-2 py-1.5 align-top text-fg-2">{field.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
