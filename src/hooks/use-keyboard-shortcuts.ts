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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;

      // Don't trigger shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        // Allow Cmd+S even in inputs
        if (!(isMeta && e.key === "s")) return;
      }

      // Cmd+S → Save
      if (isMeta && e.key === "s") {
        e.preventDefault();
        onSave?.();
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
  }, [undo, redo, selectedNodeId, selectedEdgeId, removeNode, removeEdge, onSave, onExport, onImport]);
}
