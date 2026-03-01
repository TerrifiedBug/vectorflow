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

export interface FlowState {
  nodes: Node[];
  edges: Edge[];
  globalConfig: Record<string, unknown> | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  clipboard: ClipboardData | null;
  isDirty: boolean;

  // React Flow callbacks
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  // Actions
  setSelectedNodeId: (id: string | null) => void;
  addNode: (
    componentDef: VectorComponentDef,
    position: { x: number; y: number },
  ) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  updateNodeKey: (id: string, key: string) => void;

  // Global config
  updateGlobalConfig: (key: string, value: unknown) => void;

  // Copy / Paste
  copyNode: (id: string) => void;
  pasteNode: () => void;
  duplicateNode: (id: string) => void;

  // Dirty tracking
  markClean: () => void;

  // Serialization
  loadGraph: (nodes: Node[], edges: Edge[], globalConfig?: Record<string, unknown> | null) => void;
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
  selectedEdgeId: null,
  clipboard: null,
  isDirty: false,

  _past: [],
  _future: [],
  canUndo: false,
  canRedo: false,

  /* ---- React Flow callbacks ---- */

  onNodesChange: (changes) => {
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes);

      // Track selection changes
      let selectedNodeId = state.selectedNodeId;
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) {
            selectedNodeId = change.id;
          } else if (selectedNodeId === change.id) {
            selectedNodeId = null;
          }
        }
      }

      return { nodes, selectedNodeId };
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
      const history = pushSnapshot(state);
      return {
        ...history,
        nodes: state.nodes.filter((n) => n.id !== id),
        edges: state.edges.filter(
          (e) => e.source !== id && e.target !== id,
        ),
        selectedNodeId:
          state.selectedNodeId === id ? null : state.selectedNodeId,
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
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, componentKey: key } }
          : n,
      ),
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

  /* ---- Dirty tracking ---- */

  markClean: () => {
    set({ isDirty: false });
  },

  /* ---- Serialization ---- */

  loadGraph: (nodes, edges, globalConfig) => {
    set({
      nodes,
      edges,
      globalConfig: globalConfig ?? null,
      selectedNodeId: null,
      selectedEdgeId: null,
      isDirty: false,
      _past: [],
      _future: [],
      canUndo: false,
      canRedo: false,
    });
  },

  clearGraph: () => {
    set({
      nodes: [],
      edges: [],
      globalConfig: null,
      selectedNodeId: null,
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
