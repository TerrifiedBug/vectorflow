import { create } from "zustand";
import { generateId } from "@/lib/utils";
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
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface NodeMetricsData {
  eventsPerSec: number;
  bytesPerSec: number;
  status: string;
  samples?: import("@/server/services/metric-store").MetricSample[];
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
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  updateNodeKey: (id: string, key: string) => void;
  toggleNodeDisabled: (id: string) => void;
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

  // Serialization
  loadGraph: (nodes: Node[], edges: Edge[], globalConfig?: Record<string, unknown> | null, options?: { isSystem?: boolean }) => void;
  clearGraph: () => void;

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
        ([k]) => k !== "metrics" && k !== "measured" && k !== "isSystemLocked"
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
      const newNode: Node = {
        id: generateId(),
        type: componentDef.kind,
        position,
        data: {
          componentDef,
          componentKey: `${componentDef.type}_${Date.now()}`,
          config: {},
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

  updateNodeConfig: (id, config) => {
    set((state) => {
      // Prevent editing system-locked nodes
      const node = state.nodes.find((n) => n.id === id);
      if (node?.data?.isSystemLocked) return {};

      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, config } } : n,
        ),
        isDirty: true,
      };
    });
  },

  updateNodeKey: (id, key) => {
    set((state) => {
      // Prevent editing system-locked nodes
      const node = state.nodes.find((n) => n.id === id);
      if (node?.data?.isSystemLocked) return {};

      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, componentKey: key } }
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
        componentKey: `${state.clipboard.componentDef.type}_${Date.now()}`,
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
        componentKey: `${(node.data.componentDef as VectorComponentDef).type}_${Date.now()}`,
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
        componentKey: (n.data as any).componentKey as string,
        componentType: ((n.data as any).componentDef as any).type as string,
        kind: ((n.data as any).componentDef as any).kind as string,
        config: (n.data as any).config as Record<string, unknown>,
        disabled: !!(n.data as any).disabled,
        relativePosition: { x: n.position.x - cx, y: n.position.y - cy },
      })),
      edges: selectedEdges.map((e) => {
        const sn = state.nodes.find((n) => n.id === e.source);
        const tn = state.nodes.find((n) => n.id === e.target);
        return {
          sourceKey: sn ? ((sn.data as any).componentKey as string) : "",
          targetKey: tn ? ((tn.data as any).componentKey as string) : "",
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
          componentDef: (node.data as any).componentDef,
          componentKey: (node.data as any).componentKey,
          config: { ...(node.data as any).config },
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

    const existingKeys = new Set(state.nodes.map((n) => (n.data as any).componentKey as string));
    const keyMap = new Map<string, string>();

    const newNodes: Node[] = payload.nodes.map((pn) => {
      let key = pn.componentKey;
      while (existingKeys.has(key)) {
        key = `${pn.componentKey}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      }
      existingKeys.add(key);
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
          config: pn.config,
          disabled: pn.disabled,
        },
        selected: true,
      };
    });

    const newEdges: Edge[] = payload.edges
      .map((pe) => {
        const sourceNode = newNodes.find(
          (n) => (n.data as any).componentKey === keyMap.get(pe.sourceKey)
        );
        const targetNode = newNodes.find(
          (n) => (n.data as any).componentKey === keyMap.get(pe.targetKey)
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
