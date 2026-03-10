"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface SaveSharedComponentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  pipelineId: string;
}

export function SaveSharedComponentDialog({
  open,
  onOpenChange,
  nodeId,
  pipelineId,
}: SaveSharedComponentDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { selectedEnvironmentId } = useEnvironmentStore();

  const createMutation = useMutation(
    trpc.sharedComponent.createFromNode.mutationOptions({
      onSuccess: () => {
        toast.success("Shared component created");
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        queryClient.invalidateQueries({ queryKey: trpc.sharedComponent.list.queryKey() });
        setName("");
        setDescription("");
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const handleSave = () => {
    if (!selectedEnvironmentId) return;
    createMutation.mutate({
      nodeId,
      pipelineId,
      name,
      description: description || undefined,
      environmentId: selectedEnvironmentId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as Shared Component</DialogTitle>
          <DialogDescription>
            Create a reusable component that can be linked across pipelines in this environment.
            Editing it later will notify all linked pipelines.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="sc-name">Name</Label>
            <Input
              id="sc-name"
              placeholder="e.g., Production Elasticsearch Sink"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sc-description">Description (optional)</Label>
            <Textarea
              id="sc-description"
              placeholder="What is this component used for?"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name || !selectedEnvironmentId || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
