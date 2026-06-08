"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useFlowStore } from "@/stores/flow-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CompliancePresetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * NF-2: Apply a DLP compliance preset. Lists the framework presets exposed by
 * `template.dlpCompliancePresets` and inserts a preset's bundled DLP transforms
 * into the current pipeline via the flow store. Transforms are added
 * unconnected — the operator wires them where sensitive data flows.
 */
export function CompliancePresetsDialog({ open, onOpenChange }: CompliancePresetsDialogProps) {
  const trpc = useTRPC();
  const presetsQuery = useQuery(trpc.template.dlpCompliancePresets.queryOptions());
  const presets = presetsQuery.data ?? [];

  function handleApply(preset: (typeof presets)[number]) {
    const added = useFlowStore.getState().applyDlpPreset([...preset.templateIds]);
    if (added === 0) {
      toast.error(`No ${preset.name} components could be added`, { duration: 6000 });
      return;
    }
    toast.success(
      `Added ${added} ${preset.name} ${added === 1 ? "component" : "components"} to the pipeline`,
      { description: "Connect the new transforms into your pipeline to start protecting data." },
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply a compliance preset</DialogTitle>
          <DialogDescription>
            Insert the full set of DLP transforms for a compliance framework. Each
            transform is added unconnected — wire it into the pipeline where
            sensitive data flows.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {presetsQuery.isPending && (
            <p className="text-sm text-fg-2">Loading presets…</p>
          )}
          {presetsQuery.isError && (
            <p className="text-sm text-status-error">Failed to load compliance presets.</p>
          )}
          {presets.map((preset) => (
            <div
              key={preset.framework}
              className="flex items-start justify-between gap-4 rounded-md border border-line p-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-fg-2" />
                  <span className="font-medium text-fg">{preset.name}</span>
                  <Badge variant="secondary">
                    {preset.templateIds.length}{" "}
                    {preset.templateIds.length === 1 ? "transform" : "transforms"}
                  </Badge>
                </div>
                <p className="text-sm text-fg-2">{preset.description}</p>
              </div>
              <Button
                size="sm"
                onClick={() => handleApply(preset)}
                disabled={preset.templateIds.length === 0}
              >
                Apply preset
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
