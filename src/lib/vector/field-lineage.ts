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
  const removeRegex = new RegExp(`\\bdel!?\\(\\s*(${FIELD_PATH_PATTERN})`, "g");
  const assignmentRegex = new RegExp(`^\\s*(${FIELD_PATH_PATTERN})\\s*=\\s*(.+?)\\s*$`);

  for (const line of source.split("\n")) {
    const cleanLine = line.replace(/#.*$/, "");

    for (const match of cleanLine.matchAll(removeRegex)) {
      const path = fieldPath(match[1]);
      const existing = fields.get(path);
      if (!existing || existing.status === "removed") continue;
      fields.set(path, { ...existing, status: "removed", lastChangedBy: node.id });
      changes.push({ path, status: "removed", description: `Removed by ${nodeLabel(node)}` });
    }

    const assignMatch = cleanLine.match(assignmentRegex);
    if (!assignMatch) continue;

    const path = fieldPath(assignMatch[1]);
    if (path === ".") continue;

    const previous = fields.get(path);
    const activePrevious = previous?.status !== "removed" ? previous : undefined;
    const expression = assignMatch[2];
    const sourcePathMatch = expression.trim().match(new RegExp(`^(${FIELD_PATH_PATTERN})$`));
    const sourceField = sourcePathMatch ? fields.get(fieldPath(sourcePathMatch[1])) : undefined;
    const activeSourceField = sourceField?.status !== "removed" ? sourceField : undefined;
    const nextType = inferType(expression, activeSourceField?.type ?? activePrevious?.type);
    const status: FieldLineageStatus = activeSourceField && activeSourceField.path !== path
      ? "renamed"
      : activePrevious && activePrevious.type !== nextType
        ? "type_changed"
        : activePrevious
          ? "unchanged"
          : "added";

    if (status === "unchanged") continue;

    fields.set(path, {
      path,
      type: nextType,
      description: activeSourceField
        ? `Copied from ${activeSourceField.path}`
        : activePrevious?.description ?? `Created by ${nodeLabel(node)}`,
      always: activePrevious?.always ?? activeSourceField?.always ?? false,
      status,
      sourceNodeId: activeSourceField?.sourceNodeId ?? activePrevious?.sourceNodeId ?? node.id,
      sourceComponent: activeSourceField?.sourceComponent ?? activePrevious?.sourceComponent ?? nodeLabel(node),
      lastChangedBy: node.id,
      previousPath: activeSourceField && activeSourceField.path !== path ? activeSourceField.path : activePrevious?.previousPath,
    });

    changes.push({
      path,
      status,
      description: status === "renamed"
        ? `Copied from ${activeSourceField?.path}`
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
    const configuredFields = Array.isArray(config.fields) && (config.fields as unknown[]).length > 0
      ? (config.fields as string[]).map(fieldPath)
      : [".message"];
    const changes: LineageChange[] = [];
    for (const dlpPath of configuredFields) {
      const existing = fields.get(dlpPath);
      const dlpStatus = existing ? "type_changed" : "added";
      fields.set(dlpPath, {
        path: dlpPath,
        type: existing?.type ?? "string",
        description: "DLP template may redact or mask message content",
        always: existing?.always ?? true,
        status: dlpStatus,
        sourceNodeId: existing?.sourceNodeId ?? node.id,
        sourceComponent: existing?.sourceComponent ?? nodeLabel(node),
        lastChangedBy: node.id,
        previousPath: existing?.previousPath,
      });
      changes.push({
        path: dlpPath,
        status: dlpStatus,
        description: "DLP template may redact or mask message content",
      });
    }
    return changes;
  }

  // For transforms that change event type (e.g. log_to_metric), seed fallback fields
  // for output types not present in input types so downstream expectations resolve correctly.
  const inputTypeSet = new Set(componentDef.inputTypes ?? []);
  const newOutputTypes = componentDef.outputTypes.filter((t) => !inputTypeSet.has(t));
  if (newOutputTypes.length > 0) {
    const changes: LineageChange[] = [];
    for (const type of newOutputTypes) {
      for (const field of fallbackFieldsForDataType(type)) {
        const path = fieldPath(field.path);
        if (fields.has(path)) continue;
        fields.set(path, {
          path,
          type: field.type,
          description: field.description,
          always: field.always,
          status: "added",
          sourceNodeId: node.id,
          sourceComponent: nodeLabel(node),
          lastChangedBy: node.id,
        });
        changes.push({ path, status: "added", description: `Added by ${nodeLabel(node)}` });
      }
    }
    return changes;
  }

  return [];
}

function readNestedObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sinkExpectations(node: Node, fields: Map<string, LineageField>, upstreamEventTypes: Set<DataType>): SinkExpectation[] {
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
  // sync_fields defaults to true — ES auto-populates data_stream.* fields when enabled.
  // Only flag missing data_stream fields when sync_fields is explicitly disabled.
  if (dataStream.auto_routing === true && dataStream.sync_fields === false) {
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

  if (upstreamEventTypes.has("metric")) {
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

function mergeBranchFields(branches: Map<string, LineageField>[]): Map<string, LineageField> {
  if (branches.length === 0) return new Map();
  if (branches.length === 1) return new Map([...branches[0]].map(([k, v]) => [k, { ...v }]));

  const merged = new Map<string, LineageField>();
  for (const branch of branches) {
    for (const [path, field] of branch) {
      const existing = merged.get(path);
      if (!existing) {
        merged.set(path, { ...field });
      } else if (existing.status === "removed" && field.status !== "removed") {
        merged.set(path, { ...field });
      }
    }
  }
  return merged;
}

export function buildFieldLineage(nodes: Node[], edges: Edge[], selectedNodeId: string): FieldLineageResult {
  const path = upstreamPath(nodes, edges, selectedNodeId);
  const steps: LineageStep[] = [];
  const upstreamEventTypes = new Set<DataType>();
  const nodeOutputFields = new Map<string, Map<string, LineageField>>();

  for (const node of path) {
    const data = nodeData(node);
    const componentDef = data.componentDef;
    if (!componentDef) continue;

    const incomingEdges = edges.filter(
      (e) => e.target === node.id && path.some((n) => n.id === e.source),
    );
    const branchMaps = incomingEdges
      .map((e) => nodeOutputFields.get(e.source))
      .filter((m): m is Map<string, LineageField> => !!m);
    const nodeFields = mergeBranchFields(branchMaps);

    let changes: LineageChange[] = [];
    if (componentDef.kind === "source") {
      for (const type of componentDef.outputTypes) upstreamEventTypes.add(type);
      changes = addSourceFields(node, nodeFields);
    } else if (componentDef.kind === "transform") {
      for (const type of componentDef.outputTypes) upstreamEventTypes.add(type);
      changes = transformChanges(node, nodeFields);
    }

    nodeOutputFields.set(node.id, nodeFields);

    steps.push({
      nodeId: node.id,
      componentKey: data.componentKey ?? node.id,
      label: nodeLabel(node),
      kind: componentDef.kind,
      type: componentDef.type,
      changes,
    });
  }

  const finalFields = nodeOutputFields.get(selectedNodeId) ?? new Map<string, LineageField>();
  const selected = nodes.find((node) => node.id === selectedNodeId);
  return {
    fields: [...finalFields.values()].map(cloneField).sort((a, b) => a.path.localeCompare(b.path)),
    steps,
    expectations: selected ? sinkExpectations(selected, finalFields, upstreamEventTypes) : [],
  };
}
