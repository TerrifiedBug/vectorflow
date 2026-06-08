import yaml from "js-yaml";
import { parse as parseToml } from "smol-toml";
import type { Node, Edge } from "@xyflow/react";
import { findComponentDef } from "@/lib/vector/catalog";
import { generateId } from "@/lib/utils";
import Dagre from "@dagrejs/dagre";

/**
 * Detect whether content is TOML or YAML by looking for `[sources.`,
 * `[transforms.`, or `[sinks.` — a reliable TOML-only indicator.
 */
function detectFormat(content: string): "yaml" | "toml" {
  if (/^\s*\[(sources|transforms|sinks)\./m.test(content)) {
    return "toml";
  }
  return "yaml";
}

/** Top-level keys that represent the pipeline graph — everything else is globalConfig */
const GRAPH_SECTIONS = new Set(["sources", "transforms", "sinks"]);

/**
 * Known field renames across Vector versions.
 * Key: old field name, Value: { newName, kinds (which component kinds it applies to) }
 */
const FIELD_RENAMES: Record<string, { newName: string; kinds: Set<string> }> = {
  fingerprinting: { newName: "fingerprint", kinds: new Set(["source"]) },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert request.headers.Authorization bearer/basic tokens into Vector's
 * canonical `auth` structure so the GUI auth fields are populated correctly.
 *
 * Handles:
 *  - request.headers.Authorization: "Bearer <token>" → auth.strategy=bearer, auth.token=<token>
 *  - request.headers.Authorization: "Basic <b64>"    → auth.strategy=basic, auth.user/password (decoded)
 */
function normaliseAuth(config: Record<string, unknown>): void {
  const request = config.request as Record<string, unknown> | undefined;
  const headers = request?.headers as Record<string, unknown> | undefined;
  const authHeader = headers?.Authorization as string | undefined;
  if (!authHeader || typeof authHeader !== "string") return;

  // Already has an explicit auth block — don't overwrite
  const auth = config.auth as Record<string, unknown> | undefined;
  if (auth?.strategy) return;

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    config.auth = { strategy: "bearer", token };
  } else if (authHeader.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice("Basic ".length).trim());
    const colonIdx = decoded.indexOf(":");
    if (colonIdx > -1) {
      config.auth = {
        strategy: "basic",
        user: decoded.slice(0, colonIdx),
        password: decoded.slice(colonIdx + 1),
      };
    }
  }

  // Remove the Authorization header since auth is now in the dedicated block
  delete (headers as Record<string, unknown>).Authorization;
  // Clean up empty headers/request objects
  if (Object.keys(headers as Record<string, unknown>).length === 0) {
    delete (request as Record<string, unknown>).headers;
  }
  if (Object.keys(request as Record<string, unknown>).length === 0) {
    delete config.request;
  }
}

/**
 * Rename deprecated Vector config fields to their current names.
 */
function normaliseFieldNames(config: Record<string, unknown>, kind: string): void {
  for (const [oldName, { newName, kinds }] of Object.entries(FIELD_RENAMES)) {
    if (kinds.has(kind) && oldName in config && !(newName in config)) {
      config[newName] = config[oldName];
      delete config[oldName];
    }
  }
}

export interface ImportResult {
  nodes: Node[];
  edges: Edge[];
  globalConfig: Record<string, unknown> | null;
  warnings: string[];
}

/**
 * Parse a Vector YAML (or TOML — YAML-only for now) config string and
 * return React Flow nodes + edges with auto-layout positions via dagre.
 *
 * The returned nodes carry `data: { componentDef, componentKey, config }`
 * matching the shape the flow store expects.
 *
 * Top-level sections outside sources/transforms/sinks (e.g. enrichment_tables,
 * api) are returned as `globalConfig` for separate storage.
 */
export function importVectorConfig(
  content: string,
  format?: "yaml" | "toml",
): ImportResult {
  if (!content || !content.trim()) {
    throw new Error("Config content must not be empty");
  }

  const resolvedFormat = format ?? detectFormat(content);
  const config =
    resolvedFormat === "toml"
      ? (parseToml(content) as Record<string, unknown>)
      : (yaml.load(content) as Record<string, unknown>);

  if (!config || typeof config !== "object") {
    throw new Error("Failed to parse config: result is not an object");
  }

  // Extract global config — everything that isn't sources/transforms/sinks
  const globalConfig: Record<string, unknown> = {};
  for (const key of Object.keys(config)) {
    if (!GRAPH_SECTIONS.has(key)) {
      globalConfig[key] = config[key];
    }
  }

  const nodes: Node[] = [];
  const edgeInputs: Array<{ input: string; targetKey: string; targetId: string }> = [];
  const nodeMap = new Map<string, string>();
  const componentKinds = new Map<string, "source" | "transform" | "sink">();
  const componentInputs = new Map<string, string[]>();

  const sections: Array<[string, "source" | "transform" | "sink"]> = [
    ["sources", "source"],
    ["transforms", "transform"],
    ["sinks", "sink"],
  ];

  for (const [section, kind] of sections) {
    const components = (config[section] ?? {}) as Record<string, Record<string, unknown>>;

    for (const [key, value] of Object.entries(components)) {
      const componentType: string = (value.type as string) || key;

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { type: _type, inputs: _inputs, ...nodeConfig } = value;

      // Normalise deprecated field names (e.g. fingerprinting → fingerprint)
      normaliseFieldNames(nodeConfig, kind);

      // Normalise auth: convert request.headers.Authorization bearer tokens
      // into the canonical auth: { strategy, token } structure that the GUI expects
      normaliseAuth(nodeConfig);

      const nodeId = generateId();
      nodeMap.set(key, nodeId);

      nodes.push({
        id: nodeId,
        type: kind,
        position: { x: 0, y: 0 }, // will be overwritten by dagre
        data: { componentDef, componentKey: key, config: nodeConfig },
      });

      const inputList: string[] = value.inputs
        ? Array.isArray(value.inputs)
          ? (value.inputs as string[])
          : [value.inputs as string]
        : [];
      componentKinds.set(key, kind);
      componentInputs.set(key, inputList);

      for (const input of inputList) {
        edgeInputs.push({ input, targetKey: key, targetId: nodeId });
      }
    }
  }

  const allComponentKeys = Array.from(componentKinds.keys());
  const producerComponentKeys = allComponentKeys.filter((componentKey) => componentKinds.get(componentKey) !== "sink");
  const inputMatchesComponent = (input: string, componentKey: string) => {
    if (input === componentKey) return true;
    if (!input.includes("*")) return false;

    const pattern = new RegExp(`^${input.split("*").map(escapeRegExp).join(".*")}$`);
    return pattern.test(componentKey);
  };
  const matchingProducerKeys = (input: string, targetKey: string) =>
    producerComponentKeys.filter(
      (componentKey) => componentKey !== targetKey && inputMatchesComponent(input, componentKey),
    );
  const componentHasConsumer = (componentKey: string) =>
    Array.from(componentInputs.values()).some((inputs) =>
      inputs.some((input) => inputMatchesComponent(input, componentKey)),
    );
  const warnings = Array.from(componentKinds.entries()).flatMap(([key, kind]) => {
    if (kind === "source" && !componentHasConsumer(key)) {
      return [`Orphan source "${key}": no downstream consumers reference it`];
    }

    if (kind === "sink") {
      const inputs = componentInputs.get(key) ?? [];
      const hasValidInput = inputs.some((input) => matchingProducerKeys(input, key).length > 0);
      if (!hasValidInput) {
        return [`Orphan sink "${key}": no upstream inputs are defined or connected`];
      }
    }

    return [];
  });

  const edges: Edge[] = edgeInputs.flatMap(({ input, targetKey, targetId }) =>
    matchingProducerKeys(input, targetKey).map((componentKey) => ({
      id: generateId(),
      source: nodeMap.get(componentKey)!,
      target: targetId,
    })),
  );

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

  return {
    nodes,
    edges,
    globalConfig: Object.keys(globalConfig).length > 0 ? globalConfig : null,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/*  Import diff — preview added/removed/changed components before apply */
/* ------------------------------------------------------------------ */

/** A single component-level change between an imported graph and the current one. */
export interface ImportComponentChange {
  /** Vector component name (the stable identity matched across graphs). */
  componentKey: string;
  status: "added" | "removed" | "changed";
  /** Component type — from the imported config for added/changed, the current graph for removed. */
  type: string;
}

/** Summary of what importing a config would change versus the current graph. */
export interface ImportGraphDiff {
  /** Per-component changes, ordered added → changed → removed, then by key. */
  components: ImportComponentChange[];
  /** Components present unchanged in both graphs. */
  unchanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  /** Whether non-graph global config (api, enrichment_tables, …) differs. */
  globalConfigChanged: boolean;
}

interface NodeFacts {
  key: string;
  type: string;
  kind: string;
  config: unknown;
  /** Disabled nodes are excluded from generated config but live in the editor graph. */
  disabled: boolean;
}

function nodeFacts(node: Node): NodeFacts {
  const data = node.data as {
    componentKey?: string;
    componentDef?: { type?: string; kind?: string };
    config?: unknown;
    disabled?: boolean;
  };
  return {
    key: data.componentKey ?? node.id,
    type: data.componentDef?.type ?? "",
    kind: data.componentDef?.kind ?? "",
    config: data.config ?? {},
    disabled: data.disabled ?? false,
  };
}

/** Deterministic JSON with recursively sorted object keys, for order-insensitive config equality. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Edge identity by component-key pair (node ids differ between a fresh import and the live graph). */
function edgeKeyPairs(nodes: Node[], edges: Edge[]): Set<string> {
  const idToKey = new Map(nodes.map((n) => [n.id, nodeFacts(n).key]));
  return new Set(
    edges.map((e) => `${idToKey.get(e.source) ?? e.source}\u0000${idToKey.get(e.target) ?? e.target}`),
  );
}

const STATUS_ORDER: Record<ImportComponentChange["status"], number> = {
  added: 0,
  changed: 1,
  removed: 2,
};

/**
 * Diff an imported graph against the current one so the editor can preview the
 * impact (and require confirmation) before replacing the graph. Components are
 * matched by `componentKey`; a component is `changed` when its type or config
 * differs. Pure + side-effect free.
 */
export function diffImportedGraph(
  imported: Pick<ImportResult, "nodes" | "edges" | "globalConfig">,
  current: { nodes: Node[]; edges: Edge[]; globalConfig: Record<string, unknown> | null },
): ImportGraphDiff {
  const currentByKey = new Map(current.nodes.map((n) => [nodeFacts(n).key, nodeFacts(n)]));
  const importedByKey = new Map(imported.nodes.map((n) => [nodeFacts(n).key, nodeFacts(n)]));

  const components: ImportComponentChange[] = [];
  let unchanged = 0;

  for (const [key, next] of importedByKey) {
    const prev = currentByKey.get(key);
    if (!prev) {
      components.push({ componentKey: key, status: "added", type: next.type });
    } else if (
      prev.type !== next.type ||
      prev.kind !== next.kind ||
      prev.disabled !== next.disabled ||
      stableStringify(prev.config) !== stableStringify(next.config)
    ) {
      components.push({ componentKey: key, status: "changed", type: next.type });
    } else {
      unchanged++;
    }
  }
  for (const [key, prev] of currentByKey) {
    if (!importedByKey.has(key)) {
      components.push({ componentKey: key, status: "removed", type: prev.type });
    }
  }
  components.sort((a, b) =>
    STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]
      ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      : a.componentKey < b.componentKey
        ? -1
        : a.componentKey > b.componentKey
          ? 1
          : 0,
  );

  const currentEdges = edgeKeyPairs(current.nodes, current.edges);
  const importedEdges = edgeKeyPairs(imported.nodes, imported.edges);
  let edgesAdded = 0;
  let edgesRemoved = 0;
  for (const e of importedEdges) if (!currentEdges.has(e)) edgesAdded++;
  for (const e of currentEdges) if (!importedEdges.has(e)) edgesRemoved++;

  const globalConfigChanged =
    stableStringify(imported.globalConfig ?? null) !==
    stableStringify(current.globalConfig ?? null);

  return { components, unchanged, edgesAdded, edgesRemoved, globalConfigChanged };
}
