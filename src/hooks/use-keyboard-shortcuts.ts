"use client";

import { useEffect } from "react";
import { useFlowStore } from "@/stores/flow-store";

interface KeyboardShortcutOptions {
  onSave?: () => void;
  onExport?: () => void;
  onImport?: () => void;
}

export function useKeyboardShortcuts({ onSave, onExport, onImport }: KeyboardShortcutOptions = {}) {
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const removeNode = useFlowStore((s) => s.removeNode);
  const removeEdge = useFlowStore((s) => s.removeEdge);
  const copySelectedNodes = useFlowStore((s) => s.copySelectedNodes);
  const pasteFromSession = useFlowStore((s) => s.pasteFromSession);
  const duplicateNode = useFlowStore((s) => s.duplicateNode);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;

      // Don't trigger shortcuts when typing in inputs/textareas/editors
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest(".monaco-editor")
      ) {
        // Allow Cmd+S even in inputs
        if (!(isMeta && e.key === "s")) return;
      }

      // Cmd+S → Save
      if (isMeta && e.key === "s") {
        e.preventDefault();
        onSave?.();
        return;
      }

      // Cmd+C → Copy selected node(s)
      if (isMeta && e.key === "c" && (selectedNodeId || selectedNodeIds.size > 0)) {
        e.preventDefault();
        copySelectedNodes();
        return;
      }

      // Cmd+V → Paste from session clipboard
      if (isMeta && e.key === "v") {
        e.preventDefault();
        pasteFromSession();
        return;
      }

      // Cmd+D → Duplicate selected node
      if (isMeta && e.key === "d" && selectedNodeId) {
        e.preventDefault();
        const currentNodes = useFlowStore.getState().nodes;
        const selectedNode = currentNodes.find((n) => n.id === selectedNodeId);
        if (selectedNode?.data?.isSystemLocked) return;
        duplicateNode(selectedNodeId);
        return;
      }

      // Cmd+Z → Undo
      if (isMeta && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }

      // Cmd+Shift+Z → Redo
      if (isMeta && e.shiftKey && e.key === "z") {
        e.preventDefault();
        redo();
        return;
      }

      // Delete / Backspace → Delete selected node or edge
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId) {
          const currentNodes = useFlowStore.getState().nodes;
          const selectedNode = currentNodes.find((n) => n.id === selectedNodeId);
          if (selectedNode?.data?.isSystemLocked) return;
          e.preventDefault();
          removeNode(selectedNodeId);
          return;
        }
        if (selectedEdgeId) {
          e.preventDefault();
          removeEdge(selectedEdgeId);
          return;
        }
      }

      // Cmd+E → Export YAML
      if (isMeta && e.key === "e") {
        e.preventDefault();
        onExport?.();
        return;
      }

      // Cmd+I → Import config
      if (isMeta && e.key === "i") {
        e.preventDefault();
        onImport?.();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, selectedNodeId, selectedEdgeId, removeNode, removeEdge, copySelectedNodes, pasteFromSession, duplicateNode, selectedNodeIds, onSave, onExport, onImport]);
}
