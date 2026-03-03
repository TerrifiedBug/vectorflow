"use client";

import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { useFlowStore } from "@/stores/flow-store";

interface EdgeContextMenuProps {
  edgeId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function EdgeContextMenu({ edgeId, x, y, onClose }: EdgeContextMenuProps) {
  const removeEdge = useFlowStore((s) => s.removeEdge);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: x, top: y }}
    >
      <button
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent hover:text-destructive"
        onClick={() => { removeEdge(edgeId); onClose(); }}
      >
        <Trash2 className="h-4 w-4" />
        <span className="flex-1 text-left">Delete connection</span>
        <span className="ml-4 text-xs text-muted-foreground">Del</span>
      </button>
    </div>
  );
}
