"use client";

import { useCallback, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  type ReactFlowInstance,
  type Edge,
  type Connection,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useFlowStore } from "@/stores/flow-store";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { nodeTypes } from "./node-types";
import { NodeContextMenu } from "./node-context-menu";
import { EdgeContextMenu } from "./edge-context-menu";
import { findComponentDef } from "@/lib/vector/catalog";
import type { VectorComponentDef, DataType } from "@/lib/vector/types";

interface FlowCanvasProps {
  onSave?: () => void;
  onExport?: () => void;
  onImport?: () => void;
}

function getNodeDataTypes(node: { data: Record<string, unknown> }, direction: "output" | "input"): DataType[] {
  const def = node.data.componentDef as VectorComponentDef | undefined;
  if (!def) return [];
  return direction === "output" ? (def.outputTypes ?? []) : (def.inputTypes ?? def.outputTypes ?? []);
}

function hasOverlappingTypes(a: DataType[], b: DataType[]): boolean {
  return a.some((t) => b.includes(t));
}

export function FlowCanvas({ onSave, onExport, onImport }: FlowCanvasProps) {
  useKeyboardShortcuts({ onSave, onExport, onImport });
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);
  const hasFitRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setEdgeContextMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY });
  }, []);

  const reactFlowInstance = useReactFlow();

  const onInit = useCallback((instance: ReactFlowInstance) => {
    if (!hasFitRef.current) {
      instance.fitView({ padding: 0.2 });
      hasFitRef.current = true;
    }
  }, []);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      // Prevent self-connections
      if (connection.source === connection.target) return false;

      // Enforce DataType compatibility
      const sourceTypes = getNodeDataTypes(sourceNode as { data: Record<string, unknown> }, "output");
      const targetTypes = getNodeDataTypes(targetNode as { data: Record<string, unknown> }, "input");

      if (sourceTypes.length === 0 || targetTypes.length === 0) return true;
      return hasOverlappingTypes(sourceTypes, targetTypes);
    },
    [nodes],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData(
        "application/vectorflow-component"
      );
      if (!raw) return;

      // Format: "kind:type" (e.g., "source:kafka") or legacy "type"
      const colonIdx = raw.indexOf(":");
      const kind = colonIdx > 0 ? raw.slice(0, colonIdx) as VectorComponentDef["kind"] : undefined;
      const componentType = colonIdx > 0 ? raw.slice(colonIdx + 1) : raw;

      const componentDef = findComponentDef(componentType, kind);
      if (!componentDef) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(componentDef, position);
    },
    [reactFlowInstance, addNode]
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onInit={onInit}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => { setContextMenu(null); setEdgeContextMenu(null); }}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent" />
      </ReactFlow>
      {contextMenu && (
        <NodeContextMenu
          nodeId={contextMenu.nodeId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
      {edgeContextMenu && (
        <EdgeContextMenu
          edgeId={edgeContextMenu.edgeId}
          x={edgeContextMenu.x}
          y={edgeContextMenu.y}
          onClose={() => setEdgeContextMenu(null)}
        />
      )}
    </div>
  );
}
