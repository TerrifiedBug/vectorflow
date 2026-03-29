"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Bookmark, MoreHorizontal, Star, Trash2 } from "lucide-react";

interface FilterPresetBarProps {
  environmentId: string;
  scope: "pipeline_list" | "fleet_matrix";
  currentFilters: Record<string, unknown>;
  onApplyPreset: (filters: Record<string, unknown>) => void;
  onSaveClick: () => void;
}

export function FilterPresetBar({
  environmentId,
  scope,
  currentFilters,
  onApplyPreset,
  onSaveClick,
}: FilterPresetBarProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const presetsQuery = useQuery(
    trpc.filterPreset.list.queryOptions({ environmentId, scope })
  );

  const deleteMutation = useMutation(
    trpc.filterPreset.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.filterPreset.list.queryKey(),
        });
        toast.success("Preset deleted");
      },
    })
  );

  const setDefaultMutation = useMutation(
    trpc.filterPreset.setDefault.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.filterPreset.list.queryKey(),
        });
        toast.success("Default preset updated");
      },
    })
  );

  const presets = presetsQuery.data ?? [];

  if (presets.length === 0) {
    return (
      <Button variant="outline" size="sm" className="h-8 gap-1" onClick={onSaveClick}>
        <Bookmark className="h-3.5 w-3.5" />
        Save filter
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {presets.map((preset) => {
        const isActive =
          JSON.stringify(currentFilters) ===
          JSON.stringify(preset.filters);
        return (
          <div key={preset.id} className="flex items-center gap-0.5">
            <Badge
              variant={isActive ? "default" : "outline"}
              className={cn(
                "cursor-pointer select-none transition-colors",
                isActive && "ring-1 ring-ring"
              )}
              onClick={() => onApplyPreset(preset.filters as Record<string, unknown>)}
            >
              {preset.isDefault && <Star className="mr-1 h-3 w-3 fill-current" />}
              {preset.name}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted transition-colors"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() =>
                    setDefaultMutation.mutate({
                      environmentId,
                      id: preset.id,
                      scope,
                    })
                  }
                >
                  <Star className="mr-2 h-4 w-4" />
                  Set as default
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() =>
                    deleteMutation.mutate({ environmentId, id: preset.id })
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onSaveClick}>
        <Bookmark className="h-3 w-3" />
        Save
      </Button>
    </div>
  );
}
