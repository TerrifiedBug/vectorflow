"use client";

import { useCallback, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ReactFlow,
  Controls,
  useReactFlow,
  type ReactFlowInstance,
  type Edge,
  type Connection,
  type NodeMouseHandler,
} from "@xyflow/react";
import { toast } from "sonner";
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

type ValidationResult =
  | { valid: true }
  | { valid: false; reason: "missing-node" | "self" }
  | {
      valid: false;
      reason: "type-mismatch";
      sourceTypes: DataType[];
      targetTypes: DataType[];
      sourceTypeName: string;
      targetTypeName: string;
    };

/**
 * Single source of truth for whether a Connection should be allowed.
 *
 * Used by both `isValidConnection` (live drag feedback — boolean only) and
 * `onConnect` (final commit gate — needs the failure reason + type info to
 * shape a toast). Keeping the policy in one place avoids drift between the
 * two callers.
 */
function validateConnection(
  connection: { source: string | null; target: string | null },
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
): ValidationResult {
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return { valid: false, reason: "missing-node" };
  if (connection.source === connection.target) return { valid: false, reason: "self" };

  const sourceTypes = getNodeDataTypes(sourceNode, "output");
  const targetTypes = getNodeDataTypes(targetNode, "input");

  // Type-agnostic on either side → permissive (preserves existing behaviour
  // for nodes whose VectorComponentDef has no declared types).
  if (sourceTypes.length === 0 || targetTypes.length === 0) return { valid: true };
  if (hasOverlappingTypes(sourceTypes, targetTypes)) return { valid: true };

  const sourceDef = sourceNode.data.componentDef as VectorComponentDef | undefined;
  const targetDef = targetNode.data.componentDef as VectorComponentDef | undefined;
  return {
    valid: false,
    reason: "type-mismatch",
    sourceTypes,
    targetTypes,
    sourceTypeName: sourceDef?.type ?? "unknown",
    targetTypeName: targetDef?.type ?? "unknown",
  };
}


export function FlowCanvas({ onSave, onExport, onImport }: FlowCanvasProps) {
  useKeyboardShortcuts({ onSave, onExport, onImport });
  const params = useParams<{ id: string }>();
  const pipelineId = params.id;
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnectStore = useFlowStore((s) => s.onConnect);
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
    (connection: Edge | Connection) =>
      validateConnection(
        connection,
        nodes as Array<{ id: string; data: Record<string, unknown> }>,
      ).valid,
    [nodes],
  );

  // Validate connection on drop: reject mismatched types with a toast and
  // never add the edge. React Flow already calls isValidConnection live during
  // the drag, but onConnect is the final gate before the edge is committed.
  const onConnect = useCallback(
    (connection: Connection) => {
      const result = validateConnection(
        connection,
        nodes as Array<{ id: string; data: Record<string, unknown> }>,
      );
      if (result.valid) {
        onConnectStore(connection);
        return;
      }
      if (result.reason === "type-mismatch") {
        toast.error(
          `Type mismatch: ${result.sourceTypeName}(${result.sourceTypes.join("|")}) → ${result.targetTypeName}(${result.targetTypes.join("|")})`,
        );
      }
      // self / missing-node → silent drop
    },
    [nodes, onConnectStore],
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
    <div
      className="relative h-full w-full"
      role="region"
      aria-label="Pipeline editor canvas"
    >
      {/* v2 dot-grid background — sits behind React Flow's transparent canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(var(--line-2) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          opacity: 0.5,
        }}
      />
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
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Meta"
        style={{ background: "transparent" }}
        aria-roledescription="Pipeline editor canvas. Use arrow keys to navigate between nodes, Enter to select, Escape to deselect."
      >
        <Controls className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent [&>button:focus-visible]:!ring-2 [&>button:focus-visible]:!ring-ring [&>button:focus-visible]:!outline-none" />
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
