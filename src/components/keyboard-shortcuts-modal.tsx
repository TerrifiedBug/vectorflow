"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const SHORTCUT_GROUPS = [
  {
    category: "Global",
    shortcuts: [
      { keys: ["\u2318K", "Ctrl+K"], action: "Open command palette" },
      { keys: ["?"], action: "Show keyboard shortcuts" },
    ],
  },
  {
    category: "Pipeline Editor",
    shortcuts: [
      { keys: ["\u2318S"], action: "Save pipeline" },
      { keys: ["\u2318E"], action: "Export config (YAML)" },
      { keys: ["\u2318I"], action: "Import config" },
      { keys: ["\u2318Z"], action: "Undo" },
      { keys: ["\u2318\u21E7Z"], action: "Redo" },
      { keys: ["\u2318C"], action: "Copy selected node" },
      { keys: ["\u2318V"], action: "Paste node" },
      { keys: ["\u2318D"], action: "Duplicate selected node" },
      { keys: ["Del", "Backspace"], action: "Delete selected" },
      { keys: ["Esc"], action: "Deselect all" },
    ],
  },
] as const;

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger when typing in inputs/textareas/editors
    const target = e.target as HTMLElement;
    const isInputFocused =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      !!target.closest(".monaco-editor");

    if (isInputFocused) return;

    // Don't trigger when modifier keys are held (Cmd+?, Ctrl+?, etc.)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "?") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Available shortcuts across VectorFlow.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
                {group.category}
              </h4>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.action}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-foreground">{shortcut.action}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={key} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-xs text-muted-foreground">/</span>
                          )}
                          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                            {key}
                          </kbd>
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
