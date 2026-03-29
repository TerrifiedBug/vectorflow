import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 60;

interface AutoLayoutOptions {
  /** Only reposition these node IDs. Others keep their current position. */
  nodeIds?: Set<string>;
  rankdir?: "TB" | "LR";
  nodesep?: number;
  ranksep?: number;
}

/**
 * Apply Dagre auto-layout to a set of React Flow nodes and edges.
 * Returns a new array of nodes with updated positions (immutable).
 */
export function applyAutoLayout(
  nodes: Node[],
  edges: Edge[],
  options?: AutoLayoutOptions,
): Node[] {
  if (nodes.length === 0) return [];

  const {
    nodeIds,
    rankdir = "TB",
    nodesep = 60,
    ranksep = 100,
  } = options ?? {};

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir, nodesep, ranksep });

  // If subset mode, only add the selected nodes + their connecting edges
  const targetNodeIds = nodeIds ?? new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    if (targetNodeIds.has(node.id)) {
      g.setNode(node.id, {
        width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
        height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
      });
    }
  }

  for (const edge of edges) {
    if (targetNodeIds.has(edge.source) && targetNodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  Dagre.layout(g);

  return nodes.map((node) => {
    if (!targetNodeIds.has(node.id)) return node;

    const pos = g.node(node.id);
    if (!pos) return node;

    return {
      ...node,
      position: {
        x: pos.x - (node.measured?.width ?? DEFAULT_NODE_WIDTH) / 2,
        y: pos.y - (node.measured?.height ?? DEFAULT_NODE_HEIGHT) / 2,
      },
    };
  });
}
