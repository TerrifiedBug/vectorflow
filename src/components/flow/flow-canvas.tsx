"use client";

import { useCallback, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
import { SaveSharedComponentDialog } from "./save-shared-component-dialog";
import { findComponentDef } from "@/lib/vector/catalog";
import type { VectorComponentDef, DataType } from "@/lib/vector/types";
import { DLP_VRL_SOURCES } from "@/lib/vector/dlp-vrl-sources";

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

function minimapNodeColor(node: { data: Record<string, unknown> }): string {
  const kind = (node.data?.componentDef as { kind?: string })?.kind;
  switch (kind) {
    case "source": return "#10b981";   // emerald-500
    case "transform": return "#0ea5e9"; // sky-500
    case "sink": return "#f97316";      // orange-500
    default: return "#6b7280";          // gray-500
  }
}

export function FlowCanvas({ onSave, onExport, onImport }: FlowCanvasProps) {
  useKeyboardShortcuts({ onSave, onExport, onImport });
  const params = useParams<{ id: string }>();
  const pipelineId = params.id;
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);
  const hasFitRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [saveSharedNodeId, setSaveSharedNodeId] = useState<string | null>(null);

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

      // If this is a DLP transform, pre-fill the VRL source from the template
      if (componentType.startsWith("dlp_")) {
        const dlpVrlSource = DLP_VRL_SOURCES[componentType];
        if (dlpVrlSource) {
          const allNodes = useFlowStore.getState().nodes;
          const newNode = allNodes[allNodes.length - 1];
          if (newNode) {
            useFlowStore.getState().updateNodeConfig(newNode.id, {
              ...(newNode.data.config as Record<string, unknown>),
              source: dlpVrlSource,
            });
          }
        }
      }

      // If this is a shared component drop, patch the newly added node's data
      const sharedComponentData = event.dataTransfer.getData(
        "application/vectorflow-shared-component-data"
      );
      if (sharedComponentData) {
        try {
          const sc = JSON.parse(sharedComponentData) as {
            id: string;
            name: string;
            version: number;
            config: Record<string, unknown>;
          };
          // The newly added node is always last in the nodes array
          const nodes = useFlowStore.getState().nodes;
          const newNode = nodes[nodes.length - 1];
          if (newNode) {
            useFlowStore.getState().patchNodeSharedData(newNode.id, {
              config: sc.config,
              sharedComponentId: sc.id,
              sharedComponentVersion: sc.version,
              sharedComponentName: sc.name,
              sharedComponentLatestVersion: sc.version,
            });
          }
        } catch {
          // Malformed shared component data — ignore, node was already added without link
        }
      }
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
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(0, 0, 0, 0.6)"
          className="!bg-card !border-border !shadow-md !rounded-lg"
          pannable
          zoomable
        />
      </ReactFlow>
      {contextMenu && (
        <NodeContextMenu
          nodeId={contextMenu.nodeId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onSaveAsShared={(nodeId) => setSaveSharedNodeId(nodeId)}
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
      {saveSharedNodeId && (
        <SaveSharedComponentDialog
          open={!!saveSharedNodeId}
          onOpenChange={(open) => !open && setSaveSharedNodeId(null)}
          nodeId={saveSharedNodeId}
          pipelineId={pipelineId}
        />
      )}
    </div>
  );
}
