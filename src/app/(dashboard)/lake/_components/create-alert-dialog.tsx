"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_CHANNEL = "__none__";

const COMPARATORS: { value: string; label: string }[] = [
  { value: "GT", label: "is above (>)" },
  { value: "GTE", label: "is at or above (≥)" },
  { value: "LT", label: "is below (<)" },
  { value: "LTE", label: "is at or below (≤)" },
];

const INTERVALS: { value: number; label: string }[] = [
  { value: 60, label: "every minute" },
  { value: 300, label: "every 5 minutes" },
  { value: 900, label: "every 15 minutes" },
  { value: 3600, label: "every hour" },
];

const WINDOWS: { value: number; label: string }[] = [
  { value: 300, label: "last 5 minutes" },
  { value: 900, label: "last 15 minutes" },
  { value: 3600, label: "last hour" },
  { value: 21600, label: "last 6 hours" },
  { value: 86400, label: "last 24 hours" },
];

/** Summarize params the alert will evaluate, captured from the current view. */
export interface AlertSourceSpec {
  metric: string;
  metricField?: string;
  eventType?: "log" | "metric" | "trace";
  query?: string;
  groupBy?: string;
}

function nearestWindow(seconds: number): number {
  return (
    WINDOWS.find((w) => w.value >= seconds)?.value ?? WINDOWS[WINDOWS.length - 1].value
  );
}

export function CreateAlertDialog({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  environmentId,
  source,
  defaultWindowSeconds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  environmentId: string;
  source: AlertSourceSpec;
  defaultWindowSeconds: number;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const metricLabel =
    source.metric === "count" ? "count" : `${source.metric}(${source.metricField ?? "?"})`;

  const [name, setName] = useState("");
  const [comparator, setComparator] = useState("GT");
  const [threshold, setThreshold] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [windowSeconds, setWindowSeconds] = useState(nearestWindow(defaultWindowSeconds));
  const [channelId, setChannelId] = useState(NO_CHANNEL);

  useEffect(() => {
    if (open) {
      setName(`${pipelineName}: ${metricLabel} alert`);
      setComparator("GT");
      setThreshold("");
      setIntervalSeconds(300);
      setWindowSeconds(nearestWindow(defaultWindowSeconds));
      setChannelId(NO_CHANNEL);
    }
  }, [open, pipelineName, metricLabel, defaultWindowSeconds]);

  const channelsQuery = useQuery({
    ...trpc.alert.listChannels.queryOptions({ environmentId }),
    enabled: open && !!environmentId,
  });
  const channels = (channelsQuery.data ?? []).filter((c) => c.enabled);

  const createMutation = useMutation(
    trpc.lake.alert.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.lake.alert.list.queryKey() });
        toast.success("Alert rule created");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  function submit() {
    const thresholdNum = Number(threshold);
    if (!name.trim() || !Number.isFinite(thresholdNum)) {
      toast.error("Enter a name and a numeric threshold");
      return;
    }
    createMutation.mutate({
      pipelineId,
      name: name.trim(),
      comparator,
      threshold: thresholdNum,
      intervalSeconds,
      channelId: channelId === NO_CHANNEL ? undefined : channelId,
      spec: {
        metric: source.metric,
        metricField: source.metric === "count" ? undefined : source.metricField,
        eventType: source.eventType,
        query: source.query?.trim() ? source.query.trim() : undefined,
        groupBy: source.groupBy,
        windowSeconds,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Alert on this query</DialogTitle>
          <DialogDescription>
            Evaluate <span className="font-mono">{metricLabel}</span> on{" "}
            <span className="font-medium">{pipelineName}</span> on a schedule and notify when it
            crosses a threshold.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="alert-name">Name</Label>
            <Input id="alert-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alert-comparator">Condition</Label>
              <Select value={comparator} onValueChange={setComparator}>
                <SelectTrigger id="alert-comparator" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARATORS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alert-threshold">Threshold</Label>
              <Input
                id="alert-threshold"
                type="number"
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-[120px]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alert-window">Over</Label>
              <Select
                value={String(windowSeconds)}
                onValueChange={(v) => setWindowSeconds(Number(v))}
              >
                <SelectTrigger id="alert-window" className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((w) => (
                    <SelectItem key={w.value} value={String(w.value)}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alert-interval">Check</Label>
              <Select
                value={String(intervalSeconds)}
                onValueChange={(v) => setIntervalSeconds(Number(v))}
              >
                <SelectTrigger id="alert-interval" className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => (
                    <SelectItem key={i.value} value={String(i.value)}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alert-channel">Notify via</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger id="alert-channel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHANNEL}>No channel (evaluate only)</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {channels.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No notification channels in this environment yet — the rule will evaluate but not
                notify.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
