"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";
import { Play, Square, Trash2, Loader2, X, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useDeployProgress } from "@/hooks/use-deploy-progress";

interface BulkActionBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
}

export function BulkActionBar({ selectedIds, onClearSelection }: BulkActionBarProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const count = selectedIds.length;

  const [deployOpen, setDeployOpen] = useState(false);
  const [changelog, setChangelog] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addTagsOpen, setAddTagsOpen] = useState(false);
  const [removeTagsOpen, setRemoveTagsOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState("");
  const [resultSummary, setResultSummary] = useState<{
    action: string;
    total: number;
    succeeded: number;
    failures: Array<{ pipelineId: string; error?: string }>;
  } | null>(null);

  const { startBatchDeploy, isPending: deployProgressPending } = useDeployProgress();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.pipeline.batchHealth.queryKey() });
  };

  const handleResult = (
    action: string,
    data: { total: number; succeeded: number; results: Array<{ pipelineId: string; success: boolean; error?: string }> },
  ) => {
    invalidate();
    const failures = data.results.filter((r) => !r.success);
    if (failures.length === 0) {
      toast.success(`${action}: ${data.succeeded}/${data.total} succeeded`);
      onClearSelection();
    } else {
      setResultSummary({
        action,
        total: data.total,
        succeeded: data.succeeded,
        failures,
      });
      onClearSelection();
    }
  };

  // --- Available tags from team ---
  const availableTagsQuery = useQuery(
    trpc.team.getAvailableTags.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId && (addTagsOpen || removeTagsOpen) },
    ),
  );
  const availableTags = availableTagsQuery.data ?? [];

  // bulkDeploy is now handled by useDeployProgress for progress tracking
  const bulkDeployMutation = { isPending: deployProgressPending };

  const bulkUndeployMutation = useMutation(
    trpc.pipeline.bulkUndeploy.mutationOptions({
      onSuccess: (data) => handleResult("Undeploy", data),
      onError: (err) => toast.error(err.message || "Bulk undeploy failed", { duration: 6000 }),
    }),
  );

  const bulkDeleteMutation = useMutation(
    trpc.pipeline.bulkDelete.mutationOptions({
      onSuccess: (data) => handleResult("Delete", data),
      onError: (err) => toast.error(err.message || "Bulk delete failed", { duration: 6000 }),
    }),
  );

  const bulkAddTagsMutation = useMutation(
    trpc.pipeline.bulkAddTags.mutationOptions({
      onSuccess: (data) => {
        handleResult("Add Tags", data);
        setAddTagsOpen(false);
        setSelectedTags([]);
        setCustomTagInput("");
      },
      onError: (err) => toast.error(`Failed to add tags: ${err.message}`, { duration: 6000 }),
    }),
  );

  const bulkRemoveTagsMutation = useMutation(
    trpc.pipeline.bulkRemoveTags.mutationOptions({
      onSuccess: (data) => {
        handleResult("Remove Tags", data);
        setRemoveTagsOpen(false);
        setSelectedTags([]);
        setCustomTagInput("");
      },
      onError: (err) => toast.error(`Failed to remove tags: ${err.message}`, { duration: 6000 }),
    }),
  );

  const isPending =
    deployBatchMutation.isPending ||
    bulkUndeployMutation.isPending ||
    bulkDeleteMutation.isPending ||
    bulkAddTagsMutation.isPending ||
    bulkRemoveTagsMutation.isPending;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  // Parse custom tag input (comma-separated) and deduplicate with selectedTags
  const customTags = customTagInput
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const allSelectedTags = [...new Set([...selectedTags, ...customTags])];

  const handleAddTagsConfirm = () => {
    if (allSelectedTags.length === 0) return;
    const toastId = toast.loading("Adding tags...");
    bulkAddTagsMutation.mutate(
      { pipelineIds: selectedIds, tags: allSelectedTags },
      { onSettled: () => toast.dismiss(toastId) },
    );
  };

  const handleRemoveTagsConfirm = () => {
    if (allSelectedTags.length === 0) return;
    const toastId = toast.loading("Removing tags...");
    bulkRemoveTagsMutation.mutate(
      { pipelineIds: selectedIds, tags: allSelectedTags },
      { onSettled: () => toast.dismiss(toastId) },
    );
  };

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 shadow-sm animate-in slide-in-from-bottom-2 duration-200">
        <span className="text-sm font-medium tabular-nums">
          {count} selected
        </span>
        <div className="h-5 w-px bg-border" />

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={isPending}
          onClick={() => {
            setChangelog("");
            setDeployOpen(true);
          }}
        >
          {deployBatchMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Deploy
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={isPending}
          onClick={() => bulkUndeployMutation.mutate({ pipelineIds: selectedIds })}
        >
          {bulkUndeployMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Square className="h-3 w-3" />
          )}
          Undeploy
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs text-destructive"
          disabled={isPending}
          onClick={() => setDeleteOpen(true)}
        >
          {bulkDeleteMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          Delete
        </Button>

        <div className="h-5 w-px bg-border" />

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={isPending}
          onClick={() => {
            setSelectedTags([]);
            setCustomTagInput("");
            setAddTagsOpen(true);
          }}
        >
          {bulkAddTagsMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Tag className="h-3 w-3" />
          )}
          Add Tags
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={isPending}
          onClick={() => {
            setSelectedTags([]);
            setCustomTagInput("");
            setRemoveTagsOpen(true);
          }}
        >
          {bulkRemoveTagsMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Tag className="h-3 w-3" />
          )}
          Remove Tags
        </Button>

        <div className="h-5 w-px bg-border" />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
          onClick={onClearSelection}
        >
          <X className="h-3 w-3" />
          Clear
        </Button>
      </div>

      {/* Deploy changelog dialog */}
      <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deploy {count} pipelines</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!changelog.trim()) return;
              setDeployOpen(false);
              // Use deploy progress hook — pipeline names resolved from query cache
              const pipelineInfos = selectedIds.map((id) => ({
                id,
                name: id,
              }));
              startBatchDeploy(pipelineInfos, changelog.trim());
            }}
          >
            <Input
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="Changelog message..."
              className="mb-4"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeployOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!changelog.trim()}>
                Deploy
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${count} pipelines?`}
        description="This will permanently delete the selected pipelines and all their versions. This cannot be undone."
        confirmLabel="Delete all"
        variant="destructive"
        isPending={bulkDeleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          setDeleteOpen(false);
          bulkDeleteMutation.mutate({ pipelineIds: selectedIds });
        }}
      />

      {/* Add Tags dialog */}
      <Dialog open={addTagsOpen} onOpenChange={(v) => { if (!v) setAddTagsOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Tags to {count} pipeline{count !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {availableTags.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Select tags to add:</p>
                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {availableTags.map((tag) => (
                    <label
                      key={tag}
                      className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedTags.includes(tag)}
                        onCheckedChange={() => toggleTag(tag)}
                      />
                      <Badge variant="outline" size="sm">{tag}</Badge>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Enter tags to add (comma-separated):
                </p>
                <Input
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  placeholder="production, backend, v2"
                  autoFocus
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddTagsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={allSelectedTags.length === 0 || bulkAddTagsMutation.isPending}
              onClick={handleAddTagsConfirm}
            >
              {bulkAddTagsMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Add Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Tags dialog */}
      <Dialog open={removeTagsOpen} onOpenChange={(v) => { if (!v) setRemoveTagsOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Tags from {count} pipeline{count !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {availableTags.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Select tags to remove:</p>
                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {availableTags.map((tag) => (
                    <label
                      key={tag}
                      className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedTags.includes(tag)}
                        onCheckedChange={() => toggleTag(tag)}
                      />
                      <Badge variant="outline" size="sm">{tag}</Badge>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Enter tags to remove (comma-separated):
                </p>
                <Input
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  placeholder="production, backend, v2"
                  autoFocus
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoveTagsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={allSelectedTags.length === 0 || bulkRemoveTagsMutation.isPending}
              onClick={handleRemoveTagsConfirm}
            >
              {bulkRemoveTagsMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Remove Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Partial failure result summary */}
      <Dialog open={!!resultSummary} onOpenChange={() => setResultSummary(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {resultSummary?.action}: {resultSummary?.succeeded}/{resultSummary?.total} succeeded
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {resultSummary?.failures.map((f) => (
              <div key={f.pipelineId} className="flex items-start gap-2 rounded bg-destructive/10 px-2 py-1">
                <span className="font-mono text-xs truncate">{f.pipelineId}</span>
                <span className="text-destructive text-xs">{f.error}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setResultSummary(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
