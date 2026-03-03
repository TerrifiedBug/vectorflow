"use client";

import { useEffect, useRef } from "react";
import { Copy, ClipboardPaste, Trash2, CopyPlus } from "lucide-react";
import { useFlowStore } from "@/stores/flow-store";

interface NodeContextMenuProps {
  nodeId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function NodeContextMenu({ nodeId, x, y, onClose }: NodeContextMenuProps) {
  const duplicateNode = useFlowStore((s) => s.duplicateNode);
  const removeNode = useFlowStore((s) => s.removeNode);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const copySelectedNodes = useFlowStore((s) => s.copySelectedNodes);
  const pasteFromSession = useFlowStore((s) => s.pasteFromSession);
  const nodes = useFlowStore((s) => s.nodes);
  const menuRef = useRef<HTMLDivElement>(null);

  const targetNode = nodes.find((n) => n.id === nodeId);
  const isLocked = !!targetNode?.data?.isSystemLocked;

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

  const multiCount = selectedNodeIds.size;
  const isMulti = multiCount > 1;

  const items = [
    {
      label: isMulti ? `Copy ${multiCount} components` : "Copy",
      icon: Copy,
      shortcut: "Ctrl+C",
      onClick: () => { copySelectedNodes(); onClose(); },
    },
    {
      label: "Paste",
      icon: ClipboardPaste,
      shortcut: "Ctrl+V",
      onClick: () => { pasteFromSession(); onClose(); },
    },
    ...(!isMulti ? [{
      label: "Duplicate",
      icon: CopyPlus,
      shortcut: "Ctrl+D",
      disabled: isLocked,
      onClick: () => { if (isLocked) return; duplicateNode(nodeId); onClose(); },
    }] : []),
    { separator: true as const },
    {
      label: isMulti ? `Delete ${multiCount} components` : "Delete",
      icon: Trash2,
      shortcut: "Del",
      destructive: true,
      disabled: isLocked && !isMulti,
      onClick: () => {
        if (isLocked && !isMulti) return;
        if (isMulti) {
          selectedNodeIds.forEach((id) => {
            const node = nodes.find((n) => n.id === id);
            if (!node?.data?.isSystemLocked) removeNode(id);
          });
        } else {
          removeNode(nodeId);
        }
        onClose();
      },
    },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if ("separator" in item) {
          return <div key={i} className="my-1 h-px bg-border" />;
        }
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none ${
              item.destructive ? "text-destructive hover:text-destructive" : ""
            }`}
            disabled={!!item.disabled}
            onClick={item.onClick}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1 text-left">{item.label}</span>
            <span className="ml-4 text-xs text-muted-foreground">{item.shortcut}</span>
          </button>
        );
      })}
    </div>
  );
}
