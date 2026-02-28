"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";
import { useFlowStore } from "@/stores/flow-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VectorComponentDef } from "@/lib/vector/types";

interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaveTemplateDialog({ open, onOpenChange }: SaveTemplateDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Custom");

  const teamId = useTeamStore((s) => s.selectedTeamId);

  const createMutation = useMutation(
    trpc.template.create.mutationOptions({
      onSuccess: () => {
        toast.success("Saved as template");
        queryClient.invalidateQueries({ queryKey: trpc.template.list.queryKey() });
        onOpenChange(false);
        setName("");
        setDescription("");
        setCategory("Custom");
      },
      onError: (err) => {
        toast.error("Failed to save template", { description: err.message });
      },
    })
  );

  function handleSave() {
    if (!teamId) {
      toast.error("No team found");
      return;
    }

    const nodes = useFlowStore.getState().nodes;
    const edges = useFlowStore.getState().edges;

    createMutation.mutate({
      name,
      description,
      category,
      teamId,
      nodes: nodes.map((n) => ({
        id: n.id,
        componentType: ((n.data as Record<string, unknown>).componentDef as VectorComponentDef).type,
        componentKey: (n.data as Record<string, unknown>).componentKey as string,
        kind: (n.type ?? "source") as "source" | "transform" | "sink",
        config: ((n.data as Record<string, unknown>).config as Record<string, unknown>) ?? {},
        positionX: n.position.x,
        positionY: n.position.y,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.source,
        targetNodeId: e.target,
        sourcePort: e.sourceHandle ?? undefined,
      })),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>
            Save the current pipeline as a reusable team template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              placeholder="e.g., Kafka to Elasticsearch"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-desc">Description</Label>
            <Textarea
              id="template-desc"
              placeholder="What does this template do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-category">Category</Label>
            <Input
              id="template-category"
              placeholder="e.g., Logging, Metrics, Security"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name || !description || !teamId || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving..." : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
