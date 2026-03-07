"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/** All available panels that can be added to a custom view */
export const AVAILABLE_PANELS = [
  { id: "events-in-out", label: "Events In/Out", category: "Pipeline" },
  { id: "bytes-in-out", label: "Bytes In/Out", category: "Pipeline" },
  { id: "error-rate", label: "Error Rate", category: "Pipeline" },
  { id: "data-reduction", label: "Data Reduction %", category: "Pipeline" },
  { id: "cpu-usage", label: "CPU Usage", category: "System" },
  { id: "memory-usage", label: "Memory Usage", category: "System" },
  { id: "disk-io", label: "Disk I/O", category: "System" },
  { id: "network-io", label: "Network I/O", category: "System" },
  { id: "node-health-summary", label: "Node Health Summary", category: "Summary" },
  { id: "pipeline-health-summary", label: "Pipeline Health Summary", category: "Summary" },
] as const;

export type PanelId = (typeof AVAILABLE_PANELS)[number]["id"];

interface ViewBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, the dialog operates in edit mode */
  editView?: {
    id: string;
    name: string;
    panels: string[];
  };
}

export function ViewBuilderDialog({
  open,
  onOpenChange,
  editView,
}: ViewBuilderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Render form content only when open so state resets on each open */}
        {open && (
          <ViewBuilderForm
            editView={editView}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewBuilderForm({
  editView,
  onClose,
}: {
  editView?: ViewBuilderDialogProps["editView"];
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState(editView?.name ?? "");
  const [selectedPanels, setSelectedPanels] = useState<string[]>(
    editView?.panels ? [...editView.panels] : []
  );

  const createMutation = useMutation(
    trpc.dashboard.createView.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [["dashboard", "listViews"]] });
        onClose();
      },
    })
  );

  const updateMutation = useMutation(
    trpc.dashboard.updateView.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [["dashboard", "listViews"]] });
        onClose();
      },
    })
  );

  const togglePanel = (panelId: string) => {
    setSelectedPanels((prev) =>
      prev.includes(panelId)
        ? prev.filter((p) => p !== panelId)
        : [...prev, panelId]
    );
  };

  const handleSave = () => {
    if (!name.trim() || selectedPanels.length === 0) return;

    if (editView) {
      updateMutation.mutate({
        id: editView.id,
        name: name.trim(),
        panels: selectedPanels,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        panels: selectedPanels,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const categories = [...new Set(AVAILABLE_PANELS.map((p) => p.category))];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editView ? "Edit View" : "New Custom View"}</DialogTitle>
        <DialogDescription>
          Choose a name and select which panels to include.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* Name input */}
        <div className="space-y-2">
          <Label htmlFor="view-name">Name</Label>
          <Input
            id="view-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My custom view"
            maxLength={50}
            autoFocus
          />
        </div>

        {/* Panel selection */}
        <div className="space-y-3">
          <Label>Panels</Label>
          {categories.map((category) => (
            <div key={category} className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {category}
              </p>
              <div className="grid gap-1.5">
                {AVAILABLE_PANELS.filter((p) => p.category === category).map(
                  (panel) => {
                    const isSelected = selectedPanels.includes(panel.id);
                    return (
                      <button
                        key={panel.id}
                        type="button"
                        onClick={() => togglePanel(panel.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors text-left",
                          isSelected
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border bg-transparent text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/30"
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        {panel.label}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!name.trim() || selectedPanels.length === 0 || isPending}
        >
          {isPending ? "Saving..." : editView ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}
