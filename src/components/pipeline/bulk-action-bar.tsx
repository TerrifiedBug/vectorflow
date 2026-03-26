"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Play, Square, Trash2, Loader2, X } from "lucide-react";
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

interface BulkActionBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
}

export function BulkActionBar({ selectedIds, onClearSelection }: BulkActionBarProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const count = selectedIds.length;

  const [deployOpen, setDeployOpen] = useState(false);
  const [changelog, setChangelog] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resultSummary, setResultSummary] = useState<{
    action: string;
    total: number;
    succeeded: number;
    failures: Array<{ pipelineId: string; error?: string }>;
  } | null>(null);

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

  const bulkDeployMutation = useMutation(
    trpc.pipeline.bulkDeploy.mutationOptions({
      onSuccess: (data) => handleResult("Deploy", data),
      onError: (err) => toast.error(err.message || "Bulk deploy failed"),
    }),
  );

  const bulkUndeployMutation = useMutation(
    trpc.pipeline.bulkUndeploy.mutationOptions({
      onSuccess: (data) => handleResult("Undeploy", data),
      onError: (err) => toast.error(err.message || "Bulk undeploy failed"),
    }),
  );

  const bulkDeleteMutation = useMutation(
    trpc.pipeline.bulkDelete.mutationOptions({
      onSuccess: (data) => handleResult("Delete", data),
      onError: (err) => toast.error(err.message || "Bulk delete failed"),
    }),
  );

  const isPending =
    bulkDeployMutation.isPending || bulkUndeployMutation.isPending || bulkDeleteMutation.isPending;

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
          {bulkDeployMutation.isPending ? (
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
              bulkDeployMutation.mutate({
                pipelineIds: selectedIds,
                changelog: changelog.trim(),
              });
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
