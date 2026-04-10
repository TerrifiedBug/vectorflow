"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import type { ParsedComponent } from "@/lib/config-generator";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;

export interface SubgraphInfo {
  name: string;
  color: string;
  components: ParsedComponent[];
}

export interface VectorTopologyProps {
  components: ParsedComponent[];
  subgraphs: SubgraphInfo[];
}

function layoutWithDagre(rfNodes: Node[], rfEdges: Edge[]): Node[] {
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 40,
    ranksep: 100,
    marginx: 20,
    marginy: 20,
  });

  for (const node of rfNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of rfEdges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  return rfNodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

export function VectorTopology({ components, subgraphs }: VectorTopologyProps) {
  const { nodes, edges } = useMemo(() => {
    if (components.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Build a component→color map from subgraph info
    const colorMap = new Map<string, string>();
    for (const sg of subgraphs) {
      for (const comp of sg.components) {
        colorMap.set(comp.componentKey, sg.color);
      }
    }

    // Build edges from component inputs
    const rfEdges: Edge[] = [];
    const edgeSeen = new Set<string>();
    for (const comp of components) {
      for (const inputKey of comp.inputs) {
        const edgeId = `${inputKey}->${comp.componentKey}`;
        if (!edgeSeen.has(edgeId)) {
          edgeSeen.add(edgeId);
          const color = colorMap.get(comp.componentKey) ?? colorMap.get(inputKey) ?? "#64748b";
          rfEdges.push({
            id: edgeId,
            source: inputKey,
            target: comp.componentKey,
            animated: true,
            style: { stroke: color },
          });
        }
      }
    }

    // Build nodes
    const rfNodes: Node[] = components.map((comp) => {
      const color = colorMap.get(comp.componentKey) ?? "#64748b";
      return {
        id: comp.componentKey,
        position: { x: 0, y: 0 },
        data: { label: comp.componentKey },
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          backgroundColor: `${color}15`,
          border: `2px solid ${color}`,
          borderRadius: "8px",
          fontSize: "11px",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center" as const,
          padding: "4px",
          overflow: "hidden",
          whiteSpace: "nowrap" as const,
          textOverflow: "ellipsis",
        },
        type: "default",
      };
    });

    const positioned = layoutWithDagre(rfNodes, rfEdges);
    return { nodes: positioned, edges: rfEdges };
  }, [components, subgraphs]);

  if (components.length === 0) {
    return (
      <div className="flex items-center justify-center h-[350px] border rounded-lg text-sm text-muted-foreground">
        No components to display
      </div>
    );
  }

  return (
    <div style={{ height: 350 }} className="border rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
