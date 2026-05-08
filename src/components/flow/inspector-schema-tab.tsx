"use client";

import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import { buildFieldLineage, type FieldLineageStatus } from "@/lib/vector/field-lineage";

interface InspectorSchemaTabProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
}

function formatStatus(status: FieldLineageStatus): string {
  return status.replaceAll("_", " ");
}

export function InspectorSchemaTab({ node, nodes, edges }: InspectorSchemaTabProps) {
  const fields = useMemo(
    () => buildFieldLineage(nodes, edges, node.id).fields,
    [edges, node.id, nodes],
  );

  if (fields.length === 0) {
    return (
      <p className="m-3.5 rounded-md border border-dashed border-line-2 px-3 py-6 text-center text-sm text-fg-2">
        No schema fields published for this component.
      </p>
    );
  }

  return (
    <div className="m-3.5 overflow-hidden rounded-md border">
      <table className="w-full table-fixed text-left text-xs font-mono">
        <thead className="bg-bg-2 text-[10px] uppercase tracking-[0.04em] text-fg-2">
          <tr className="border-b border-line">
            <th className="px-2 py-1.5 font-medium">Field</th>
            <th className="px-2 py-1.5 font-medium">Type</th>
            <th className="px-2 py-1.5 font-medium">Source component</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.path} className="border-b border-line last:border-b-0">
              <td className="px-2 py-1.5 align-top text-fg">{field.path}</td>
              <td className="px-2 py-1.5 align-top text-fg-2">{field.type}</td>
              <td className="px-2 py-1.5 align-top text-fg-2">{field.sourceComponent}</td>
              <td className="px-2 py-1.5 align-top text-fg-2">{formatStatus(field.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
