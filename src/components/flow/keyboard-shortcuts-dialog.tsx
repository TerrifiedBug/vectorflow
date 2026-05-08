"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUT_GROUPS = [
  {
    category: "File",
    shortcuts: [
      { keys: "Cmd+S", action: "Save pipeline" },
      { keys: "Cmd+E", action: "Export config (YAML)" },
      { keys: "Cmd+I", action: "Import config" },
    ],
  },
  {
    category: "Edit",
    shortcuts: [
      { keys: "Cmd+Z", action: "Undo" },
      { keys: "Cmd+Shift+Z / Cmd+Y", action: "Redo" },
      { keys: "Cmd+C", action: "Copy selected node(s)" },
      { keys: "Cmd+V", action: "Paste node(s)" },
      { keys: "Cmd+D", action: "Duplicate selected node" },
      { keys: "Del / Backspace", action: "Delete selected" },
    ],
  },
] as const;

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category}>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                {group.category}
              </h4>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.action}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{shortcut.action}</span>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                      {shortcut.keys}
                    </kbd>
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
