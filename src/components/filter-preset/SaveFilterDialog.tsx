"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface SaveFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: string;
  scope: "pipeline_list" | "fleet_matrix";
  filters: Record<string, unknown>;
}

export function SaveFilterDialog({
  open,
  onOpenChange,
  environmentId,
  scope,
  filters,
}: SaveFilterDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const createMutation = useMutation(
    trpc.filterPreset.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.filterPreset.list.queryKey(),
        });
        toast.success("Filter preset saved");
        setName("");
        setIsDefault(false);
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save filter preset</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              placeholder="e.g. PCI pipelines, Production errors"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="preset-default"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            <Label htmlFor="preset-default" className="text-sm font-normal">
              Set as default (auto-apply on page load)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                environmentId,
                name: name.trim(),
                scope,
                filters,
                isDefault,
              })
            }
          >
            {createMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
