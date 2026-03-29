import { create } from "zustand";
import { generateId } from "@/lib/utils";
import { generateComponentKey } from "@/lib/component-key";
import { applySuggestion } from "@/lib/ai/suggestion-applier";
import type { AiSuggestion } from "@/lib/ai/types";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import type { VectorComponentDef } from "@/lib/vector/types";
import { findComponentDef } from "@/lib/vector/catalog";
import { validateNodeConfig } from "@/lib/vector/validate-node-config";
import { applyAutoLayout } from "@/lib/auto-layout";

/** Shape of node.data used throughout the flow editor */
interface FlowNodeData {
  componentDef: VectorComponentDef;
  componentKey: string;
  displayName?: string;
  config: Record<string, unknown>;
  disabled?: boolean;
  metrics?: NodeMetricsData;
  isSystemLocked?: boolean;
  hasError?: boolean;
  firstErrorMessage?: string;
  sharedComponentId?: string | null;
  sharedComponentVersion?: number | null;
  sharedComponentName?: string | null;
  sharedComponentLatestVersion?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export interface ClipboardData {
  componentDef: VectorComponentDef;
  componentKey: string;
  displayName?: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface NodeMetricsData {
  eventsPerSec: number;
  bytesPerSec: number;
  /** For transforms: received events rate (shows filtering delta vs eventsPerSec which is sent) */
  eventsInPerSec?: number;
  status: string;
  samples?: import("@/server/services/metric-store").MetricSample[];
  latencyMs?: number | null;
}

export interface FlowState {
  nodes: Node[];
  edges: Edge[];
  globalConfig: Record<string, unknown> | null;
  selectedNodeId: string | null;
  selectedNodeIds: Set<string>;
  selectedEdgeId: string | null;
  clipboard: ClipboardData | null;
  isDirty: boolean;
  isSystemPipeline: boolean;

  // React Flow callbacks
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  // Actions
  setSelectedNodeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: Set<string>) => void;
  toggleNodeSelection: (id: string) => void;
  clearSelection: () => void;
  addNode: (
    componentDef: VectorComponentDef,
    position: { x: number; y: number },
  ) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  updateNodeConfig: (id: string, config: Record<string, unknown>, configSchema?: object) => void;
  updateDisplayName: (id: string, displayName: string) => void;
  toggleNodeDisabled: (id: string) => void;
  patchNodeSharedData: (id: string, data: {
    config: Record<string, unknown>;
    sharedComponentId: string;
    sharedComponentVersion: number;
    sharedComponentName: string;
    sharedComponentLatestVersion: number;
  }) => void;
  acceptNodeSharedUpdate: (id: string, config: Record<string, unknown>, version: number) => void;
  unlinkNode: (id: string) => void;
  updateNodeMetrics: (metricsMap: Map<string, NodeMetricsData>) => void;

  // Global config
  updateGlobalConfig: (key: string, value: unknown) => void;
  setGlobalConfig: (config: Record<string, unknown> | null) => void;

  // Copy / Paste
  copyNode: (id: string) => void;
  pasteNode: () => void;
  duplicateNode: (id: string) => void;
  copySelectedNodes: () => void;
  pasteFromSession: () => void;

  // Dirty tracking
  markClean: () => void;

  // AI suggestions
  applySuggestions: (suggestions: AiSuggestion[]) => {
    results: Array<{ suggestionId: string; success: boolean; error?: string }>;
  };

  // Serialization
  loadGraph: (nodes: Node[], edges: Edge[], globalConfig?: Record<string, unknown> | null, options?: { isSystem?: boolean }) => void;
  clearGraph: () => void;

  // Canvas search
  canvasSearchTerm: string;
  canvasSearchMatchIds: string[];
  canvasSearchActiveIndex: number;
  setCanvasSearchTerm: (term: string) => void;
  cycleCanvasSearchMatch: (direction: "next" | "prev") => void;
  clearCanvasSearch: () => void;

  // Detail panel collapse
  detailPanelCollapsed: boolean;
  toggleDetailPanel: () => void;

  // Auto-layout
  autoLayout: (selectedOnly?: boolean) => void;

  // Undo / Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/* ------------------------------------------------------------------ */
/*  Internal history state (kept outside the public interface)         */
/* ------------------------------------------------------------------ */

interface InternalState extends FlowState {
  _past: Snapshot[];
  _future: Snapshot[];
  _savedSnapshot: string | null;
}

/* ------------------------------------------------------------------ */
/*  Fingerprinting (for dirty-state comparison)                        */
/* ------------------------------------------------------------------ */

function computeFlowFingerprint(nodes: Node[], edges: Edge[], globalConfig: Record<string, unknown> | null): string {
  const cleanNodes = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: Object.fromEntries(
      Object.entries(n.data as Record<string, unknown>).filter(
        ([k]) => k !== "metrics" && k !== "measured" && k !== "isSystemLocked" && k !== "sharedComponentName" && k !== "sharedComponentLatestVersion"
      )
    ),
  }));
  const cleanEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));
  return JSON.stringify({ nodes: cleanNodes, edges: cleanEdges, globalConfig });
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function takeSnapshot(state: InternalState): Snapshot {
  return {
    nodes: state.nodes.map((n) => ({ ...n, data: { ...n.data } })),
    edges: state.edges.map((e) => ({ ...e })),
  };
}

function pushSnapshot(state: InternalState): Partial<InternalState> {
  const snapshot = takeSnapshot(state);
  const past = [...state._past, snapshot].slice(-MAX_HISTORY);
  return { _past: past, _future: [], canUndo: true, canRedo: false };
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useFlowStore = create<InternalState>()((set, get) => ({
  nodes: [],
  edges: [],
  globalConfig: null,
  selectedNodeId: null,
  selectedNodeIds: new Set<string>(),
  selectedEdgeId: null,
  clipboard: null,
  isDirty: false,
  isSystemPipeline: false,

  _past: [],
  _future: [],
  _savedSnapshot: null,
  canUndo: false,
  canRedo: false,

  // Canvas search
  canvasSearchTerm: "",
  canvasSearchMatchIds: [],
  canvasSearchActiveIndex: -1,

  // Detail panel collapse
  detailPanelCollapsed: typeof window !== "undefined"
    ? localStorage.getItem("vf-detail-panel-collapsed") === "true"
    : false,

  /* ---- React Flow callbacks ---- */

  onNodesChange: (changes) => {
    set((state) => {
      // Filter out position and remove changes for system-locked nodes
      const lockedIds = new Set(
        state.nodes
          .filter((n) => n.data?.isSystemLocked)
          .map((n) => n.id),
      );
      const filteredChanges = changes.filter((change) => {
        if ("id" in change && lockedIds.has(change.id)) {
          if (change.type === "position" || change.type === "remove") {
            return false;
          }
        }
        return true;
      });

      const nodes = applyNodeChanges(filteredChanges, state.nodes);
      const newSelectedIds = new Set(state.selectedNodeIds);
      let selectedNodeId = state.selectedNodeId;

      for (const change of filteredChanges) {
        if (change.type === "select") {
          if (change.selected) {
            newSelectedIds.add(change.id);
            selectedNodeId = change.id;
          } else {
            newSelectedIds.delete(change.id);
            if (selectedNodeId === change.id) {
              selectedNodeId = null;
            }
          }
        }
      }

      return { nodes, selectedNodeId, selectedNodeIds: newSelectedIds };
    });
  },

  onEdgesChange: (changes) => {
    set((state) => {
      const edges = applyEdgeChanges(changes, state.edges);

      // Track edge selection
      let selectedEdgeId = state.selectedEdgeId;
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) {
            selectedEdgeId = change.id;
          } else if (selectedEdgeId === change.id) {
            selectedEdgeId = null;
          }
        }
        if (change.type === "remove" && selectedEdgeId === change.id) {
          selectedEdgeId = null;
        }
      }

      return { edges, selectedEdgeId };
    });
  },

  onConnect: (connection) => {
    set((state) => ({
      edges: addEdge(
        { ...connection, id: generateId() },
        state.edges,
      ),
      isDirty: true,
    }));
  },

  /* ---- Actions ---- */

  setSelectedNodeId: (id) => {
    set({ selectedNodeId: id });
  },

  setSelectedNodeIds: (ids) => {
    set({ selectedNodeIds: ids });
  },

  toggleNodeSelection: (id) => {
    set((state) => {
      const newIds = new Set(state.selectedNodeIds);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return { selectedNodeIds: newIds, selectedNodeId: id };
    });
  },

  clearSelection: () => {
    set({ selectedNodeIds: new Set(), selectedNodeId: null });
  },

  addNode: (componentDef, position) => {
    set((state) => {
      const history = pushSnapshot(state);
      // Populate initial config from schema defaults (e.g. remap source: ".")
      const schema = componentDef.configSchema as {
        properties?: Record<string, { default?: unknown }>;
      };
      const config: Record<string, unknown> = {};
      if (schema?.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          if (prop.default !== undefined && typeof prop.default === "string") {
            config[key] = prop.default;
          }
        }
      }
      const newNode: Node = {
        id: generateId(),
        type: componentDef.kind,
        position,
        data: {
          componentDef,
          componentKey: generateComponentKey(componentDef.type),
          displayName: componentDef.displayName,
          config,
        },
      };
      return {
        ...history,
        nodes: [...state.nodes, newNode],
        isDirty: true,
      };
    });
  },

  removeNode: (id) => {
    set((state) => {
      // Prevent deletion of system-locked nodes
      const node = state.nodes.find((n) => n.id === id);
      if (node?.data?.isSystemLocked) return {};

      const history = pushSnapshot(state);
      const newSelectedIds = new Set(state.selectedNodeIds);
      newSelectedIds.delete(id);
      return {
        ...history,
        nodes: state.nodes.filter((n) => n.id !== id),
        edges: state.edges.filter(
          (e) => e.source !== id && e.target !== id,
        ),
        selectedNodeId:
          state.selectedNodeId === id ? null : state.selectedNodeId,
        selectedNodeIds: newSelectedIds,
        isDirty: true,
      };
    });
  },

  removeEdge: (id) => {
    set((state) => {
      const history = pushSnapshot(state);
      return {
        ...history,
        edges: state.edges.filter((e) => e.id !== id),
        selectedEdgeId:
          state.selectedEdgeId === id ? null : state.selectedEdgeId,
        isDirty: true,
      };
    });
  },

  updateNodeConfig: (id, config, configSchema) => {
    set((state) => {
      // Prevent editing system-locked nodes
      const node = state.nodes.find((n) => n.id === id);
      if (node?.data?.isSystemLocked) return {};

      // Compute validation state from schema if provided
      let hasError: boolean | undefined;
      let firstErrorMessage: string | undefined;
      if (configSchema) {
        const result = validateNodeConfig(config, configSchema);
        hasError = result.hasError || undefined; // undefined when no error (cleans field from data)
        firstErrorMessage = result.firstErrorMessage;
      }

      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, config, hasError, firstErrorMessage } }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  updateDisplayName: (id, displayName) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === id);
      if (node?.data?.isSystemLocked) return {};

      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, displayName } }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  toggleNodeDisabled: (id) => {
    set((state) => {
      // Prevent toggling system-locked nodes
      const node = state.nodes.find((n) => n.id === id);
      if (node?.data?.isSystemLocked) return {};

      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, disabled: !n.data.disabled } }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  patchNodeSharedData: (id, data) => {
    set((state) => {
      // Amend the last history entry — the addNode call already pushed a snapshot
      return {
        nodes: state.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  config: data.config,
                  sharedComponentId: data.sharedComponentId,
                  sharedComponentVersion: data.sharedComponentVersion,
                  sharedComponentName: data.sharedComponentName,
                  sharedComponentLatestVersion: data.sharedComponentLatestVersion,
                },
              }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  acceptNodeSharedUpdate: (id, config, version) => {
    set((state) => {
      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  config,
                  sharedComponentVersion: version,
                  sharedComponentLatestVersion: version,
                },
              }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  unlinkNode: (id) => {
    set((state) => {
      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  sharedComponentId: null,
                  sharedComponentVersion: null,
                  sharedComponentName: null,
                  sharedComponentLatestVersion: null,
                },
              }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  updateNodeMetrics: (metricsMap) => {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        const key = n.data.componentKey as string;
        const m = metricsMap.get(key);
        if (m) {
          return { ...n, data: { ...n.data, metrics: m } };
        }
        // Clear stale metrics if no longer reported
        if (n.data.metrics) {
          return { ...n, data: { ...n.data, metrics: undefined } };
        }
        return n;
      }),
      // Do NOT set isDirty — metrics are ephemeral, not user edits
    }));
  },

  /* ---- Global config ---- */

  updateGlobalConfig: (key, value) => {
    set((state) => {
      const current = state.globalConfig ?? {};
      const updated = { ...current };
      if (value === undefined || value === "" || value === null) {
        delete updated[key];
      } else {
        updated[key] = value;
      }
      return {
        globalConfig: Object.keys(updated).length > 0 ? updated : null,
        isDirty: true,
      };
    });
  },

  setGlobalConfig: (config) => {
    set({
      globalConfig: config && Object.keys(config).length > 0 ? config : null,
      isDirty: true,
    });
  },

  /* ---- Copy / Paste ---- */

  copyNode: (id) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === id);
    if (!node) return;
    set({
      clipboard: {
        componentDef: node.data.componentDef as VectorComponentDef,
        componentKey: node.data.componentKey as string,
        displayName: (node.data as unknown as FlowNodeData).displayName,
        config: { ...(node.data.config as Record<string, unknown>) },
        position: { x: node.position.x, y: node.position.y },
      },
    });
  },

  pasteNode: () => {
    const state = get() as InternalState;
    if (!state.clipboard) return;
    const history = pushSnapshot(state);
    const offset = 40;
    const newNode: Node = {
      id: generateId(),
      type: state.clipboard.componentDef.kind,
      position: {
        x: state.clipboard.position.x + offset,
        y: state.clipboard.position.y + offset,
      },
      data: {
        componentDef: state.clipboard.componentDef,
        componentKey: generateComponentKey(state.clipboard.componentDef.type),
        displayName: state.clipboard.displayName,
        config: { ...state.clipboard.config },
      },
      selected: true,
    };
    set({
      ...history,
      nodes: [
        ...state.nodes.map((n) => ({ ...n, selected: false })),
        newNode,
      ],
      selectedNodeId: newNode.id,
      isDirty: true,
      // Update clipboard position so next paste offsets again
      clipboard: { ...state.clipboard, position: newNode.position },
    });
  },

  duplicateNode: (id) => {
    const state = get() as InternalState;
    const node = state.nodes.find((n) => n.id === id);
    if (!node) return;
    if (node.data?.isSystemLocked) return;
    const history = pushSnapshot(state);
    const offset = 40;
    const newNode: Node = {
      id: generateId(),
      type: node.type,
      position: {
        x: node.position.x + offset,
        y: node.position.y + offset,
      },
      data: {
        componentDef: node.data.componentDef,
        componentKey: generateComponentKey((node.data.componentDef as VectorComponentDef).type),
        displayName: (node.data as unknown as FlowNodeData).displayName,
        config: { ...(node.data.config as Record<string, unknown>) },
      },
      selected: true,
    };
    set({
      ...history,
      nodes: [
        ...state.nodes.map((n) => ({ ...n, selected: false })),
        newNode,
      ],
      selectedNodeId: newNode.id,
      isDirty: true,
    });
  },

  copySelectedNodes: () => {
    const state = get();
    let selectedIds = new Set(state.selectedNodeIds);
    // Fall back to single-node for backward compat
    if (selectedIds.size === 0 && state.selectedNodeId) {
      selectedIds = new Set([state.selectedNodeId]);
    }
    if (selectedIds.size === 0) return;

    const selectedNodes = state.nodes.filter((n) => selectedIds.has(n.id));
    const cx = selectedNodes.reduce((s, n) => s + n.position.x, 0) / selectedNodes.length;
    const cy = selectedNodes.reduce((s, n) => s + n.position.y, 0) / selectedNodes.length;

    const selectedEdges = state.edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
    );

    const payload = {
      nodes: selectedNodes.map((n) => ({
        componentKey: (n.data as unknown as FlowNodeData).componentKey,
        displayName: (n.data as unknown as FlowNodeData).displayName,
        componentType: (n.data as unknown as FlowNodeData).componentDef.type,
        kind: (n.data as unknown as FlowNodeData).componentDef.kind,
        config: (n.data as unknown as FlowNodeData).config,
        disabled: !!(n.data as unknown as FlowNodeData).disabled,
        relativePosition: { x: n.position.x - cx, y: n.position.y - cy },
      })),
      edges: selectedEdges.map((e) => {
        const sn = state.nodes.find((n) => n.id === e.source);
        const tn = state.nodes.find((n) => n.id === e.target);
        return {
          sourceKey: sn ? (sn.data as unknown as FlowNodeData).componentKey : "",
          targetKey: tn ? (tn.data as unknown as FlowNodeData).componentKey : "",
          sourcePort: (e.sourceHandle as string) ?? null,
        };
      }),
      copiedAt: new Date().toISOString(),
    };

    try {
      sessionStorage.setItem("vf:clipboard", JSON.stringify(payload));
    } catch {
      // sessionStorage unavailable
    }

    // Also update the legacy single-node clipboard for backward compat
    if (selectedNodes.length === 1) {
      const node = selectedNodes[0];
      set({
        clipboard: {
          componentDef: (node.data as unknown as FlowNodeData).componentDef,
          componentKey: (node.data as unknown as FlowNodeData).componentKey,
          displayName: (node.data as unknown as FlowNodeData).displayName,
          config: { ...(node.data as unknown as FlowNodeData).config },
          position: { x: node.position.x, y: node.position.y },
        },
      });
    }
  },

  pasteFromSession: () => {
    const state = get() as InternalState;
    if (state.isSystemPipeline) return;

    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("vf:clipboard");
    } catch {
      return;
    }
    if (!raw) return;

    let payload: {
      nodes: Array<{
        componentKey: string;
        displayName?: string;
        componentType: string;
        kind: string;
        config: Record<string, unknown>;
        disabled: boolean;
        relativePosition: { x: number; y: number };
      }>;
      edges: Array<{
        sourceKey: string;
        targetKey: string;
        sourcePort: string | null;
      }>;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload.nodes || payload.nodes.length === 0) return;

    const history = pushSnapshot(state);

    // Place at center of viewport area (approximate)
    const cx = 400;
    const cy = 300;

    const keyMap = new Map<string, string>();

    const newNodes: Node[] = payload.nodes.map((pn) => {
      const key = generateComponentKey(pn.componentType);
      keyMap.set(pn.componentKey, key);

      const componentDef = findComponentDef(pn.componentType, pn.kind as "source" | "transform" | "sink");
      return {
        id: generateId(),
        type: pn.kind,
        position: {
          x: cx + pn.relativePosition.x,
          y: cy + pn.relativePosition.y,
        },
        data: {
          componentDef: componentDef ?? {
            type: pn.componentType,
            kind: pn.kind,
            displayName: pn.componentType,
            description: "",
            category: "Unknown",
            outputTypes: [],
            configSchema: {},
          },
          componentKey: key,
          displayName: pn.displayName,
          config: pn.config,
          disabled: pn.disabled,
        },
        selected: true,
      };
    });

    const newEdges: Edge[] = payload.edges
      .map((pe) => {
        const sourceNode = newNodes.find(
          (n) => (n.data as unknown as FlowNodeData).componentKey === keyMap.get(pe.sourceKey)
        );
        const targetNode = newNodes.find(
          (n) => (n.data as unknown as FlowNodeData).componentKey === keyMap.get(pe.targetKey)
        );
        if (!sourceNode || !targetNode) return null;
        return {
          id: generateId(),
          source: sourceNode.id,
          target: targetNode.id,
          ...(pe.sourcePort ? { sourceHandle: pe.sourcePort } : {}),
        };
      })
      .filter(Boolean) as Edge[];

    set({
      ...history,
      nodes: [
        ...state.nodes.map((n) => ({ ...n, selected: false })),
        ...newNodes,
      ],
      edges: [...state.edges, ...newEdges],
      selectedNodeIds: new Set(newNodes.map((n) => n.id)),
      selectedNodeId: newNodes[0]?.id ?? null,
      isDirty: true,
    });
  },

  /* ---- Dirty tracking ---- */

  markClean: () => {
    const state = get() as InternalState;
    const snapshot = computeFlowFingerprint(state.nodes, state.edges, state.globalConfig);
    set({ isDirty: false, _savedSnapshot: snapshot } as Partial<InternalState>);
  },

  /* ---- AI suggestions ---- */

  applySuggestions: (suggestions) => {
    const results: Array<{ suggestionId: string; success: boolean; error?: string }> = [];

    set((state) => {
      let { nodes, edges } = state;
      let anyApplied = false;

      for (const suggestion of suggestions) {
        const result = applySuggestion(suggestion, nodes, edges);
        if (result.error) {
          results.push({ suggestionId: suggestion.id, success: false, error: result.error });
        } else {
          nodes = result.nodes;
          edges = result.edges;
          anyApplied = true;
          results.push({ suggestionId: suggestion.id, success: true });
        }
      }

      // Only push an undo snapshot when something actually changed
      if (!anyApplied) return {};

      const history = pushSnapshot(state);
      return {
        ...history,
        nodes,
        edges,
        isDirty: true,
      };
    });

    return { results };
  },

  /* ---- Serialization ---- */

  loadGraph: (nodes, edges, globalConfig, options) => {
    const isSystem = options?.isSystem ?? false;

    // Preserve live metrics from current nodes through reloads
    const currentNodes = (get() as InternalState).nodes;
    const metricsMap = new Map<string, unknown>();
    for (const n of currentNodes) {
      const metrics = (n.data as Record<string, unknown>).metrics;
      if (metrics) metricsMap.set(n.id, metrics);
    }

    // For system pipelines, mark source nodes as locked
    const processedNodes = nodes.map((n) => {
      let data = { ...n.data };
      const isLocked = isSystem && n.type === "source";
      if (isLocked) {
        data = { ...data, isSystemLocked: true };
      }
      const existingMetrics = metricsMap.get(n.id);
      if (existingMetrics) {
        data = { ...data, metrics: existingMetrics };
      }
      return { ...n, data, draggable: isLocked ? false : undefined };
    });

    const gc = globalConfig ?? null;
    const snapshot = computeFlowFingerprint(nodes, edges, gc);

    set({
      nodes: processedNodes,
      edges,
      globalConfig: gc,
      isSystemPipeline: isSystem,
      selectedNodeId: null,
      selectedNodeIds: new Set(),
      selectedEdgeId: null,
      isDirty: false,
      _past: [],
      _future: [],
      canUndo: false,
      canRedo: false,
      _savedSnapshot: snapshot,
    } as Partial<InternalState>);
  },

  clearGraph: () => {
    set({
      nodes: [],
      edges: [],
      globalConfig: null,
      isSystemPipeline: false,
      selectedNodeId: null,
      selectedNodeIds: new Set(),
      selectedEdgeId: null,
      isDirty: false,
      _past: [],
      _future: [],
      canUndo: false,
      canRedo: false,
    });
  },

  /* ---- Canvas Search ---- */

  setCanvasSearchTerm: (term) => {
    if (!term) {
      set({ canvasSearchTerm: "", canvasSearchMatchIds: [], canvasSearchActiveIndex: -1 });
      return;
    }
    const lowerTerm = term.toLowerCase();
    const matches = get().nodes
      .filter((n) => {
        const data = n.data as { displayName?: string; componentDef?: { type: string; displayName: string } };
        const displayName = data.displayName ?? data.componentDef?.displayName ?? "";
        const compType = data.componentDef?.type ?? "";
        return displayName.toLowerCase().includes(lowerTerm) || compType.toLowerCase().includes(lowerTerm);
      })
      .map((n) => n.id);
    set({
      canvasSearchTerm: term,
      canvasSearchMatchIds: matches,
      canvasSearchActiveIndex: matches.length > 0 ? 0 : -1,
    });
  },

  cycleCanvasSearchMatch: (direction) => {
    const { canvasSearchMatchIds, canvasSearchActiveIndex } = get();
    if (canvasSearchMatchIds.length === 0) return;
    const len = canvasSearchMatchIds.length;
    const next = direction === "next"
      ? (canvasSearchActiveIndex + 1) % len
      : (canvasSearchActiveIndex - 1 + len) % len;
    set({ canvasSearchActiveIndex: next });
  },

  clearCanvasSearch: () => {
    set({ canvasSearchTerm: "", canvasSearchMatchIds: [], canvasSearchActiveIndex: -1 });
  },

  /* ---- Detail Panel Collapse ---- */

  toggleDetailPanel: () => {
    const collapsed = !get().detailPanelCollapsed;
    set({ detailPanelCollapsed: collapsed });
    if (typeof window !== "undefined") {
      localStorage.setItem("vf-detail-panel-collapsed", String(collapsed));
    }
  },

  /* ---- Auto-Layout ---- */

  autoLayout: (selectedOnly) => {
    const state = get();
    const history = pushSnapshot(state as InternalState);
    const nodeIds = selectedOnly && state.selectedNodeIds.size > 1
      ? state.selectedNodeIds
      : undefined;
    const layoutedNodes = applyAutoLayout(state.nodes, state.edges, { nodeIds });
    set({
      ...history,
      nodes: layoutedNodes,
    });
  },

  /* ---- Undo / Redo ---- */

  undo: () => {
    const state = get() as InternalState;
    if (state._past.length === 0) return;

    const previous = state._past[state._past.length - 1];
    const newPast = state._past.slice(0, -1);
    const currentSnapshot = takeSnapshot(state);

    set({
      nodes: previous.nodes,
      edges: previous.edges,
      _past: newPast,
      _future: [currentSnapshot, ...state._future].slice(0, MAX_HISTORY),
      canUndo: newPast.length > 0,
      canRedo: true,
      isDirty: true,
    });
  },

  redo: () => {
    const state = get() as InternalState;
    if (state._future.length === 0) return;

    const next = state._future[0];
    const newFuture = state._future.slice(1);
    const currentSnapshot = takeSnapshot(state);

    set({
      nodes: next.nodes,
      edges: next.edges,
      _past: [...state._past, currentSnapshot].slice(-MAX_HISTORY),
      _future: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
      isDirty: true,
    });
  },
}));

/* ------------------------------------------------------------------ */
/*  Auto-recompute isDirty against saved snapshot                      */
/* ------------------------------------------------------------------ */

useFlowStore.subscribe((state) => {
  const internal = state as unknown as InternalState;
  if (internal._savedSnapshot === null) return;
  const current = computeFlowFingerprint(internal.nodes, internal.edges, internal.globalConfig);
  const shouldBeDirty = current !== internal._savedSnapshot;
  if (internal.isDirty !== shouldBeDirty) {
    useFlowStore.setState({ isDirty: shouldBeDirty });
  }
});
