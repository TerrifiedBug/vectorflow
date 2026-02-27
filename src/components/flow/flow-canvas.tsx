"use client";

import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useFlowStore } from "@/stores/flow-store";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { nodeTypes } from "./node-types";
import { VECTOR_CATALOG } from "@/lib/vector/catalog";

interface FlowCanvasProps {
  onSave?: () => void;
  onExport?: () => void;
  onImport?: () => void;
}

export function FlowCanvas({ onSave, onExport, onImport }: FlowCanvasProps) {
  useKeyboardShortcuts({ onSave, onExport, onImport });
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);

  const reactFlowInstance = useReactFlow();

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const componentType = event.dataTransfer.getData(
        "application/vectorflow-component"
      );
      if (!componentType) return;

      const componentDef = VECTOR_CATALOG.find(
        (def) => def.type === componentType
      );
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
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls />
        <MiniMap
          zoomable
          pannable
          className="!bg-background !border-border"
        />
      </ReactFlow>
    </div>
  );
}
