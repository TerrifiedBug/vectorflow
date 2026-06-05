"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Square, RotateCcw } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_VALUE = "__all__";

const RANGE_PRESETS: Record<string, { label: string; ms: number }> = {
  "1h": { label: "Last hour", ms: 60 * 60 * 1000 },
  "6h": { label: "Last 6 hours", ms: 6 * 60 * 60 * 1000 },
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
};

// `=== true` membership is prototype-safe: inherited keys resolve to functions.
const ACTIVE_STATUSES: Record<string, true> = { PENDING: true, RUNNING: true };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary",
  RUNNING: "default",
  COMPLETED: "outline",
  CANCELLED: "destructive",
  FAILED: "destructive",
};

interface ReplayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pipeline whose lake events are replayed (the lake-search dataset). */
  sourcePipelineId: string;
  sourcePipelineName: string;
  /** Environment of the source dataset — scopes the target-pipeline picker. */
  environmentId: string;
  /** Pre-fill the replay filter from the current lake search. */
  defaultEventType?: string;
  defaultQuery?: string;
}

export function ReplayDialog({
  open,
  onOpenChange,
  sourcePipelineId,
  sourcePipelineName,
  environmentId,
  defaultEventType,
  defaultQuery,
}: ReplayDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [targetPipelineId, setTargetPipelineId] = useState("");
  const [rangeKey, setRangeKey] = useState("1h");
  const [jobId, setJobId] = useState<string | null>(null);

  // Reset to the form view whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setTargetPipelineId("");
      setRangeKey("1h");
      setJobId(null);
    }
  }, [open]);

  const pipelinesQuery = useQuery({
    ...trpc.pipeline.list.queryOptions({ environmentId }),
    enabled: open && !!environmentId,
  });
  const targets = pipelinesQuery.data?.pipelines ?? [];

  const replaysQuery = useQuery({
    ...trpc.replay.list.queryOptions({ pipelineId: sourcePipelineId }),
    enabled: open && !!sourcePipelineId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((j) => ACTIVE_STATUSES[j.status] === true) ? 2_000 : false,
  });
  const recentReplays = replaysQuery.data ?? [];

  const jobQuery = useQuery({
    ...trpc.replay.get.queryOptions({ pipelineId: targetPipelineId, jobId: jobId ?? "" }),
    enabled: !!jobId && !!targetPipelineId,
    refetchInterval: (query) =>
      query.state.data && ACTIVE_STATUSES[query.state.data.status] === true ? 2_000 : false,
  });
  const job = jobQuery.data;

  function invalidateReplays() {
    queryClient.invalidateQueries({ queryKey: trpc.replay.list.queryKey() });
  }

  const createMutation = useMutation(
    trpc.replay.create.mutationOptions({
      onSuccess: (created) => {
        setJobId(created.id);
        invalidateReplays();
        toast.success("Replay started");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const cancelMutation = useMutation(
    trpc.replay.cancel.mutationOptions({
      onSuccess: () => {
        invalidateReplays();
        jobQuery.refetch();
        toast.success("Replay cancelled");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  function startReplay() {
    if (!targetPipelineId) return;
    const to = new Date();
    const from = new Date(to.getTime() - (RANGE_PRESETS[rangeKey]?.ms ?? RANGE_PRESETS["1h"].ms));
    const eventType: "log" | "metric" | "trace" | undefined =
      defaultEventType && defaultEventType !== ALL_VALUE
        ? (defaultEventType as "log" | "metric" | "trace")
        : undefined;
    const query = defaultQuery?.trim() ? defaultQuery.trim() : undefined;
    createMutation.mutate({
      pipelineId: targetPipelineId,
      sourcePipelineId,
      fromTime: from,
      toTime: to,
      filter: eventType || query ? { eventType, query } : undefined,
    });
  }

  const total = job ? Number(job.totalEvents) : 0;
  const replayed = job ? Number(job.replayedEvents) : 0;
  const pct = job
    ? total > 0
      ? Math.min(100, Math.round((replayed / total) * 100))
      : job.status === "COMPLETED"
        ? 100
        : 0
    : 0;
  const jobActive = job ? ACTIVE_STATUSES[job.status] === true : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Replay to pipeline</DialogTitle>
          <DialogDescription>
            Re-read stored events from <span className="font-medium">{sourcePipelineName}</span> and
            re-inject them into a target pipeline. Replayed events are dedupe-stamped so a re-run is
            idempotent.
          </DialogDescription>
        </DialogHeader>

        {!jobId ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="replay-target">Target pipeline</Label>
              <Select value={targetPipelineId} onValueChange={setTargetPipelineId}>
                <SelectTrigger id="replay-target">
                  <SelectValue placeholder="Select a pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {targets.length === 0 ? (
                    <SelectItem value={ALL_VALUE} disabled>
                      No pipelines in this environment
                    </SelectItem>
                  ) : (
                    targets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="replay-range">Time window</Label>
              <Select value={rangeKey} onValueChange={setRangeKey}>
                <SelectTrigger id="replay-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RANGE_PRESETS).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {recentReplays.length > 0 && (
              <div className="space-y-1 border-t border-line pt-3">
                <p className="text-xs text-muted-foreground">Recent replays</p>
                {recentReplays.slice(0, 5).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate font-mono">
                      {Number(r.replayedEvents).toLocaleString()} /{" "}
                      {Number(r.totalEvents).toLocaleString()}
                    </span>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={job ? STATUS_VARIANT[job.status] ?? "secondary" : "secondary"}>
                {job?.status ?? "…"}
              </Badge>
            </div>
            <Progress value={pct} />
            <p className="text-center font-mono text-xs text-muted-foreground">
              {replayed.toLocaleString()} / {total.toLocaleString()} events ({pct}%)
            </p>
            {job?.error && <p className="text-xs text-destructive">{job.error}</p>}
          </div>
        )}

        <DialogFooter>
          {!jobId ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                className="gap-1.5"
                disabled={!targetPipelineId || createMutation.isPending}
                onClick={startReplay}
              >
                <Play className="h-4 w-4" />
                {createMutation.isPending ? "Starting…" : "Start replay"}
              </Button>
            </>
          ) : (
            <>
              {jobActive && jobId && (
                <Button
                  variant="destructive"
                  className="gap-1.5"
                  disabled={cancelMutation.isPending}
                  onClick={() =>
                    cancelMutation.mutate({ pipelineId: targetPipelineId, jobId })
                  }
                >
                  <Square className="h-4 w-4" />
                  Cancel replay
                </Button>
              )}
              <Button variant="outline" className="gap-1.5" onClick={() => setJobId(null)}>
                <RotateCcw className="h-4 w-4" />
                New replay
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
