"use client";

import { useEffect, useRef } from "react";
import {
  Copy,
  ClipboardPaste,
  Trash2,
  CopyPlus,
  Share2,
  Power,
  Replace,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flow-store";

interface NodeContextMenuProps {
  nodeId: string;
  x: number;
  y: number;
  onClose: () => void;
  onSaveAsShared?: (nodeId: string) => void;
}

interface MenuAction {
  separator?: false;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface MenuSeparator {
  separator: true;
}

type MenuItem = MenuAction | MenuSeparator;

export function NodeContextMenu({
  nodeId,
  x,
  y,
  onClose,
  onSaveAsShared,
}: NodeContextMenuProps) {
  const duplicateNode = useFlowStore((s) => s.duplicateNode);
  const removeNode = useFlowStore((s) => s.removeNode);
  const toggleNodeDisabled = useFlowStore((s) => s.toggleNodeDisabled);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const copySelectedNodes = useFlowStore((s) => s.copySelectedNodes);
  const pasteFromSession = useFlowStore((s) => s.pasteFromSession);
  const nodes = useFlowStore((s) => s.nodes);
  const menuRef = useRef<HTMLDivElement>(null);

  const targetNode = nodes.find((n) => n.id === nodeId);
  const isLocked = !!targetNode?.data?.isSystemLocked;
  const isShared = !!targetNode?.data?.sharedComponentId;
  const isDisabled = !!targetNode?.data?.disabled;

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

  const items: MenuItem[] = [
    {
      label: isMulti ? `Copy ${multiCount} components` : "Copy",
      icon: Copy,
      shortcut: "Ctrl+C",
      onClick: () => {
        copySelectedNodes();
        onClose();
      },
    },
    {
      label: "Paste",
      icon: ClipboardPaste,
      shortcut: "Ctrl+V",
      onClick: () => {
        pasteFromSession();
        onClose();
      },
    },
    ...(!isMulti
      ? ([
          {
            label: "Duplicate",
            icon: CopyPlus,
            shortcut: "Ctrl+D",
            disabled: isLocked,
            onClick: () => {
              if (isLocked) return;
              duplicateNode(nodeId);
              onClose();
            },
          },
          {
            label: isDisabled ? "Enable" : "Disable",
            icon: Power,
            disabled: isLocked || isShared,
            onClick: () => {
              if (isLocked || isShared) return;
              toggleNodeDisabled(nodeId);
              onClose();
            },
          },
          // TODO: Replace kind UI not yet implemented — see plan B1.6a.
          {
            label: "Replace kind",
            icon: Replace,
            disabled: true,
            onClick: () => {
              /* not implemented */
            },
          },
        ] as MenuAction[])
      : []),
    ...(!isMulti && !isLocked && !isShared && onSaveAsShared
      ? ([
          {
            label: "Save as Shared Component",
            icon: Share2,
            onClick: () => {
              onSaveAsShared(nodeId);
              onClose();
            },
          },
        ] as MenuAction[])
      : []),
    { separator: true },
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
      role="menu"
      className="fixed z-50 min-w-[200px] rounded-[3px] border border-line-2 bg-bg-2 p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={`sep-${i}`} className="my-1 h-px bg-line" />;
        }
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            role="menuitem"
            type="button"
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1.5 font-mono text-[12px] outline-none transition-colors",
              "hover:bg-bg-3 focus-visible:bg-bg-3",
              "disabled:pointer-events-none disabled:opacity-50",
              item.destructive ? "text-status-error" : "text-fg-1 hover:text-fg",
            )}
            disabled={!!item.disabled}
            onClick={item.onClick}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="ml-3 text-[10px] text-fg-2">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
