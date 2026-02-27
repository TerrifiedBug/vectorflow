import { create } from "zustand";
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

export interface FlowState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;

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
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  updateNodeKey: (id: string, key: string) => void;

  // Serialization
  loadGraph: (nodes: Node[], edges: Edge[]) => void;
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
  selectedNodeId: null,

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
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    }));
  },

  onConnect: (connection) => {
    set((state) => ({
      edges: addEdge(
        { ...connection, id: crypto.randomUUID() },
        state.edges,
      ),
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
        id: crypto.randomUUID(),
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

  /* ---- Serialization ---- */

  loadGraph: (nodes, edges) => {
    set({
      nodes,
      edges,
      selectedNodeId: null,
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
      selectedNodeId: null,
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
    });
  },
}));
