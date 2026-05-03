import type { Edge, Node } from "@xyflow/react";
import type { VectorComponentDef, DataType } from "@/lib/vector/types";
import { getSourceOutputSchema, type OutputFieldSchema } from "./source-output-schemas";

export type FieldLineageStatus = "source" | "added" | "renamed" | "type_changed" | "removed" | "unchanged";
export type SinkExpectationStatus = "met" | "missing";

export interface LineageField {
  path: string;
  type: string;
  description: string;
  always: boolean;
  status: FieldLineageStatus;
  sourceNodeId: string;
  sourceComponent: string;
  lastChangedBy?: string;
  previousPath?: string;
}

export interface LineageChange {
  path: string;
  status: FieldLineageStatus;
  description: string;
}

export interface LineageStep {
  nodeId: string;
  componentKey: string;
  label: string;
  kind: VectorComponentDef["kind"];
  type: string;
  changes: LineageChange[];
}

export interface SinkExpectation {
  path: string;
  type: string;
  reason: string;
  status: SinkExpectationStatus;
}

export interface FieldLineageResult {
  fields: LineageField[];
  steps: LineageStep[];
  expectations: SinkExpectation[];
}

type FlowNodeData = {
  componentDef?: VectorComponentDef;
  componentKey?: string;
  displayName?: string;
  config?: Record<string, unknown>;
};

const UNKNOWN_FIELD_TYPE = "unknown";
const FIELD_PATH_PATTERN = "\\.[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";

function nodeData(node: Node): FlowNodeData {
  return node.data as FlowNodeData;
}

function fieldPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function nodeLabel(node: Node): string {
  const data = nodeData(node);
  return data.displayName || data.componentDef?.displayName || data.componentKey || node.id;
}

function cloneField(field: LineageField): LineageField {
  return { ...field };
}

function upstreamPath(nodes: Node[], edges: Edge[], selectedNodeId: string): Node[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selected = byId.get(selectedNodeId);
  if (!selected) return [];

  const visited = new Set<string>();
  const ordered: Node[] = [];

  function visit(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    for (const edge of edges.filter((candidate) => candidate.target === nodeId)) {
      visit(edge.source);
    }

    const node = byId.get(nodeId);
    if (node) ordered.push(node);
  }

  visit(selectedNodeId);
  return ordered;
}

function addSourceFields(node: Node, fields: Map<string, LineageField>): LineageChange[] {
  const data = nodeData(node);
  const componentDef = data.componentDef;
  if (!componentDef) return [];

  const schema = getSourceOutputSchema(componentDef.type);
  const sourceFields: OutputFieldSchema[] =
    schema?.fields ??
    componentDef.outputTypes.flatMap((type) => fallbackFieldsForDataType(type));

  const changes: LineageChange[] = [];
  for (const field of sourceFields) {
    const path = fieldPath(field.path);
    if (fields.has(path)) continue;

    fields.set(path, {
      path,
      type: field.type,
      description: field.description,
      always: field.always,
      status: "source",
      sourceNodeId: node.id,
      sourceComponent: componentDef.displayName,
    });
    changes.push({
      path,
      status: "source",
      description: `Emitted by ${componentDef.displayName}`,
    });
  }

  return changes;
}

function fallbackFieldsForDataType(type: DataType): OutputFieldSchema[] {
  if (type === "metric") {
    return [
      { path: ".name", type: "string", description: "Metric name", always: true },
      { path: ".kind", type: "string", description: "Metric kind", always: true },
      { path: ".timestamp", type: "timestamp", description: "Metric timestamp", always: true },
    ];
  }

  if (type === "trace") {
    return [
      { path: ".trace_id", type: "string", description: "Trace identifier", always: true },
      { path: ".span_id", type: "string", description: "Span identifier", always: true },
      { path: ".timestamp", type: "timestamp", description: "Trace timestamp", always: true },
    ];
  }

  return [
    { path: ".message", type: "string", description: "Log message payload", always: true },
    { path: ".timestamp", type: "timestamp", description: "Event timestamp", always: true },
  ];
}

function inferType(expression: string, previousType?: string): string {
  if (/\bto_int!?\s*\(/.test(expression)) return "integer";
  if (/\bto_float!?\s*\(/.test(expression)) return "float";
  if (/\bto_bool!?\s*\(/.test(expression)) return "boolean";
  if (/\bparse_timestamp!?\s*\(/.test(expression) || /\bnow\s*\(/.test(expression)) return "timestamp";
  if (/^["'`]/.test(expression)) return "string";
  if (/^\d+$/.test(expression)) return "integer";
  if (/^\d+\.\d+$/.test(expression)) return "float";
  if (/^(true|false)\b/.test(expression)) return "boolean";
  if (/^\{/.test(expression)) return "object";
  if (/^\[/.test(expression)) return "array";
  return previousType ?? UNKNOWN_FIELD_TYPE;
}

function parseRemapChanges(source: string, node: Node, fields: Map<string, LineageField>): LineageChange[] {
  const changes: LineageChange[] = [];
  const removed = new Set<string>();
  const removeRegex = new RegExp(`\\b(?:del|remove)!?\\(\\s*(${FIELD_PATH_PATTERN})`, "g");

  for (const match of source.matchAll(removeRegex)) {
    const path = fieldPath(match[1]);
    const existing = fields.get(path);
    if (!existing) continue;

    fields.set(path, {
      ...existing,
      status: "removed",
      lastChangedBy: node.id,
    });
    removed.add(path);
    changes.push({
      path,
      status: "removed",
      description: `Removed by ${nodeLabel(node)}`,
    });
  }

  const assignmentRegex = new RegExp(`^\\s*(${FIELD_PATH_PATTERN})\\s*=\\s*(.+?)\\s*$`);
  for (const line of source.split("\n")) {
    const cleanLine = line.replace(/#.*$/, "");
    const match = cleanLine.match(assignmentRegex);
    if (!match) continue;

    const path = fieldPath(match[1]);
    if (path === "." || removed.has(path)) continue;

    const expression = match[2];
    const sourcePathMatch = expression.trim().match(new RegExp(`^(${FIELD_PATH_PATTERN})$`));
    const previous = fields.get(path);
    const sourceField = sourcePathMatch ? fields.get(fieldPath(sourcePathMatch[1])) : undefined;
    const nextType = inferType(expression, sourceField?.type ?? previous?.type);
    const status: FieldLineageStatus = sourceField && sourceField.path !== path
      ? "renamed"
      : previous && previous.type !== nextType
        ? "type_changed"
        : previous
          ? "unchanged"
          : "added";

    if (status === "unchanged") continue;

    fields.set(path, {
      path,
      type: nextType,
      description: sourceField
        ? `Copied from ${sourceField.path}`
        : previous?.description ?? `Created by ${nodeLabel(node)}`,
      always: previous?.always ?? sourceField?.always ?? false,
      status,
      sourceNodeId: sourceField?.sourceNodeId ?? previous?.sourceNodeId ?? node.id,
      sourceComponent: sourceField?.sourceComponent ?? previous?.sourceComponent ?? nodeLabel(node),
      lastChangedBy: node.id,
      previousPath: sourceField && sourceField.path !== path ? sourceField.path : previous?.previousPath,
    });

    changes.push({
      path,
      status,
      description: status === "renamed"
        ? `Copied from ${sourceField?.path}`
        : status === "type_changed"
          ? `Type changed to ${nextType}`
          : `Added by ${nodeLabel(node)}`,
    });
  }

  return changes;
}

function transformChanges(node: Node, fields: Map<string, LineageField>): LineageChange[] {
  const data = nodeData(node);
  const componentDef = data.componentDef;
  const config = data.config ?? {};
  if (!componentDef) return [];

  if (componentDef.type === "remap" && typeof config.source === "string") {
    return parseRemapChanges(config.source, node, fields);
  }

  if (componentDef.type.startsWith("dlp_")) {
    return [
      {
        path: ".message",
        status: fields.has(".message") ? "type_changed" : "added",
        description: "DLP template may redact or mask message content",
      },
    ];
  }

  return [];
}

function readNestedObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sinkExpectations(node: Node, fields: Map<string, LineageField>): SinkExpectation[] {
  const data = nodeData(node);
  const componentDef = data.componentDef;
  const config = data.config ?? {};
  if (!componentDef || componentDef.kind !== "sink") return [];

  const expectations: Array<Omit<SinkExpectation, "status">> = [];
  const idKey = config.id_key;
  if (typeof idKey === "string" && idKey.trim()) {
    expectations.push({
      path: fieldPath(idKey),
      type: UNKNOWN_FIELD_TYPE,
      reason: "Used as the sink document id",
    });
  }

  const dataStream = readNestedObject(config.data_stream);
  if (dataStream.auto_routing === true) {
    expectations.push(
      { path: ".data_stream.type", type: "string", reason: "Required for Elasticsearch data stream auto-routing" },
      { path: ".data_stream.dataset", type: "string", reason: "Required for Elasticsearch data stream auto-routing" },
      { path: ".data_stream.namespace", type: "string", reason: "Required for Elasticsearch data stream auto-routing" },
    );
  }

  const encoding = readNestedObject(config.encoding);
  const codec = encoding.codec;
  if (codec === "raw_message" || codec === "text") {
    expectations.push({
      path: ".message",
      type: "string",
      reason: `Required by ${String(codec)} encoding`,
    });
  }

  if (componentDef.inputTypes?.includes("metric")) {
    expectations.push(
      { path: ".name", type: "string", reason: "Required metric event field" },
      { path: ".kind", type: "string", reason: "Required metric event field" },
      { path: ".timestamp", type: "timestamp", reason: "Required metric event field" },
    );
  }

  return expectations.map((expectation) => ({
    ...expectation,
    status: fields.has(expectation.path) && fields.get(expectation.path)?.status !== "removed"
      ? "met"
      : "missing",
  }));
}

export function buildFieldLineage(nodes: Node[], edges: Edge[], selectedNodeId: string): FieldLineageResult {
  const path = upstreamPath(nodes, edges, selectedNodeId);
  const fields = new Map<string, LineageField>();
  const steps: LineageStep[] = [];

  for (const node of path) {
    const data = nodeData(node);
    const componentDef = data.componentDef;
    if (!componentDef) continue;

    let changes: LineageChange[] = [];
    if (componentDef.kind === "source") {
      changes = addSourceFields(node, fields);
    } else if (componentDef.kind === "transform") {
      changes = transformChanges(node, fields);
    }

    steps.push({
      nodeId: node.id,
      componentKey: data.componentKey ?? node.id,
      label: nodeLabel(node),
      kind: componentDef.kind,
      type: componentDef.type,
      changes,
    });
  }

  const selected = nodes.find((node) => node.id === selectedNodeId);
  return {
    fields: [...fields.values()].map(cloneField).sort((a, b) => a.path.localeCompare(b.path)),
    steps,
    expectations: selected ? sinkExpectations(selected, fields) : [],
  };
}
