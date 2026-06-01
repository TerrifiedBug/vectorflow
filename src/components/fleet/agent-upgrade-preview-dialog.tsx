"use client";

/**
 * Agent upgrade preview + bulk trigger.
 *
 * Exposes three fleet capabilities that previously had no client caller:
 *   - `fleet.previewAgentUpgrade` — dry-run plan (eligible / blocked / waves / risk).
 *   - `fleet.triggerAgentUpdates`  — update the selected nodes now, all at once.
 *   - `fleet.triggerBulkAgentUpdate` — staged rollout (triggers the first wave).
 *
 * Reusable for a single node or a multi-select set (the `nodeIds` array).
 * All three procedures are ADMIN-gated server-side.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryError } from "@/components/query-error";

const RISK_TONE: Record<string, "healthy" | "degraded" | "error"> = {
  low: "healthy",
  medium: "degraded",
  high: "error",
};

export function AgentUpgradePreviewDialog({
  open,
  onOpenChange,
  environmentId,
  nodeIds,
  targetVersion,
  downloadUrl,
  checksum,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: string;
  nodeIds: string[];
  targetVersion: string | null;
  downloadUrl: string;
  checksum: string;
  onCompleted?: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [staged, setStaged] = useState(false);
  const [waveSize, setWaveSize] = useState(10);

  const canPreview = open && !!targetVersion && nodeIds.length > 0;

  const previewQuery = useQuery(
    trpc.fleet.previewAgentUpgrade.queryOptions(
      {
        environmentId,
        targetVersion: targetVersion ?? "",
        selector: { nodeIds },
        waveSize,
      },
      { enabled: canPreview },
    ),
  );

  const invalidateFleet = () =>
    queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });

  const updatesMutation = useMutation(
    trpc.fleet.triggerAgentUpdates.mutationOptions({
      onSuccess: (data) => {
        invalidateFleet();
        toast.success(
          `Triggered ${data.updatedCount} update${data.updatedCount === 1 ? "" : "s"}` +
            (data.skipped.length ? ` · ${data.skipped.length} skipped` : ""),
        );
        onCompleted?.();
        onOpenChange(false);
      },
      onError: (error) =>
        toast.error(error.message || "Failed to trigger updates", { duration: 6000 }),
    }),
  );

  const bulkMutation = useMutation(
    trpc.fleet.triggerBulkAgentUpdate.mutationOptions({
      onSuccess: (data) => {
        invalidateFleet();
        const totalWaves = data.plan.waves.length;
        toast.success(
          `Started rollout — wave 1 of ${totalWaves} triggered (${data.updatedCount} node${data.updatedCount === 1 ? "" : "s"})` +
            (data.remainingNodeIds.length
              ? ` · ${data.remainingNodeIds.length} queued in later waves`
              : ""),
        );
        onCompleted?.();
        onOpenChange(false);
      },
      onError: (error) =>
        toast.error(error.message || "Failed to start rollout", { duration: 6000 }),
    }),
  );

  const plan = previewQuery.data;
  const eligible = plan?.summary.eligible ?? 0;
  const pending = updatesMutation.isPending || bulkMutation.isPending;

  function handleConfirm() {
    if (!targetVersion) return;
    if (staged) {
      bulkMutation.mutate({
        environmentId,
        targetVersion,
        selector: { nodeIds },
        waveSize,
        downloadUrl,
        checksum,
      });
    } else {
      updatesMutation.mutate({
        environmentId,
        nodeIds,
        targetVersion,
        downloadUrl,
        checksum,
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!pending) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update {nodeIds.length} selected agent{nodeIds.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            {targetVersion
              ? <>Preview the rollout to version <span className="font-mono">{targetVersion}</span> before triggering it.</>
              : "The latest agent version is unavailable — retry once version info has loaded."}
          </DialogDescription>
        </DialogHeader>

        {!targetVersion ? null : previewQuery.isError ? (
          <QueryError
            message="Failed to build the upgrade preview"
            onRetry={() => previewQuery.refetch()}
          />
        ) : previewQuery.isLoading || !plan ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Risk</span>
              <StatusBadge variant={RISK_TONE[plan.summary.risk] ?? "neutral"}>
                {plan.summary.risk}
              </StatusBadge>
              <span className="ml-auto text-sm text-muted-foreground">
                {plan.summary.eligible} of {plan.summary.totalMatched} eligible
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Already current</dt>
              <dd className="text-right tabular-nums">{plan.summary.blockedAlreadyCurrent}</dd>
              <dt className="text-muted-foreground">Docker (manual)</dt>
              <dd className="text-right tabular-nums">{plan.summary.blockedDocker}</dd>
              <dt className="text-muted-foreground">Unreachable</dt>
              <dd className="text-right tabular-nums">{plan.summary.blockedUnreachable}</dd>
              <dt className="text-muted-foreground">Update pending</dt>
              <dd className="text-right tabular-nums">{plan.summary.blockedPendingAction}</dd>
            </dl>

            {plan.summary.degradedEligibleNodeIds.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {plan.summary.degradedEligibleNodeIds.length} degraded agent
                  {plan.summary.degradedEligibleNodeIds.length === 1 ? "" : "s"} included
                </AlertTitle>
                <AlertDescription>
                  Degraded agents are eligible but may not complete the update cleanly.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="staged-rollout">Staged rollout</Label>
                <p className="text-xs text-muted-foreground">
                  Trigger one wave at a time instead of all eligible agents at once.
                </p>
              </div>
              <Switch
                id="staged-rollout"
                checked={staged}
                onCheckedChange={setStaged}
              />
            </div>

            {staged && (
              <div className="space-y-2">
                <Label htmlFor="wave-size">Wave size</Label>
                <Input
                  id="wave-size"
                  type="number"
                  min={1}
                  max={100}
                  value={waveSize}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setWaveSize(Math.min(100, Math.max(1, Math.trunc(n))));
                  }}
                  className="w-28"
                />
                <p className="text-xs text-muted-foreground">
                  This action triggers the first wave ({Math.min(waveSize, eligible)} agent
                  {Math.min(waveSize, eligible) === 1 ? "" : "s"}). Re-run to advance later waves.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={pending || !targetVersion || previewQuery.isLoading || eligible === 0}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Triggering...
              </>
            ) : staged ? (
              `Start rollout (${Math.min(waveSize, eligible)})`
            ) : (
              `Update ${eligible} agent${eligible === 1 ? "" : "s"} now`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
