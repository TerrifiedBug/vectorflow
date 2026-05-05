"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

const SHORTCUT_GROUPS = [
  {
    category: "Global",
    shortcuts: [
      { keys: ["⌘K", "Ctrl+K"], action: "Open command palette" },
      { keys: ["⌘/", "?"], action: "Show keyboard shortcuts" },
      { keys: ["/"], action: "Focus search" },
      { keys: ["g", "d"], action: "Go to Dashboard" },
      { keys: ["g", "p"], action: "Go to Pipelines" },
      { keys: ["g", "f"], action: "Go to Fleet" },
      { keys: ["g", "a"], action: "Go to Alerts" },
      { keys: ["g", "i"], action: "Go to Incidents" },
      { keys: ["g", "s"], action: "Go to Settings" },
    ],
  },
  {
    category: "Pipeline Editor",
    shortcuts: [
      { keys: ["⌘S"], action: "Save pipeline" },
      { keys: ["⌘E"], action: "Export config (YAML)" },
      { keys: ["⌘I"], action: "Import config" },
      { keys: ["⌘Z"], action: "Undo" },
      { keys: ["⌘⇧Z"], action: "Redo" },
      { keys: ["⌘C"], action: "Copy selected node" },
      { keys: ["⌘V"], action: "Paste node" },
      { keys: ["⌘D"], action: "Duplicate selected node" },
      { keys: ["Del", "Backspace"], action: "Delete selected" },
      { keys: ["Esc"], action: "Deselect all" },
    ],
  },
] as const;

let openKeyboardShortcutsModal: (() => void) | null = null;

export function triggerKeyboardShortcutsModal() {
  openKeyboardShortcutsModal?.();
}

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    openKeyboardShortcutsModal = () => setOpen((prev) => !prev);
    return () => {
      openKeyboardShortcutsModal = null;
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="border-line bg-bg-2 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-[18px] font-medium">Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="text-[12px] text-fg-2">
            Available shortcuts across VectorFlow.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category}>
              <h4 className="mb-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-fg-2">
                {group.category}
              </h4>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.action} className="flex items-center justify-between text-[12px]">
                    <span className="text-fg">{shortcut.action}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, index) => (
                        <span key={key} className="flex items-center gap-1">
                          {index > 0 && <span className="text-xs text-fg-2">/</span>}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
