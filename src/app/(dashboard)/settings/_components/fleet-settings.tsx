"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";

// ─── Fleet Tab ─────────────────────────────────────────────────────────────────

export function FleetSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  const [pollIntervalSec, setPollIntervalSec] = useState(15);
  const [unhealthyThreshold, setUnhealthyThreshold] = useState(3);
  const [metricsRetentionDays, setMetricsRetentionDays] = useState(7);
  const [fleetDirty, setFleetDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    if (fleetDirty) return; // Don't overwrite dirty state on refetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPollIntervalSec(Math.round(settings.fleetPollIntervalMs / 1000));
    setUnhealthyThreshold(settings.fleetUnhealthyThreshold);
    if (settings.metricsRetentionDays) setMetricsRetentionDays(settings.metricsRetentionDays);
  }, [settings, fleetDirty]);

  const updateFleetMutation = useMutation(
    trpc.settings.updateFleet.mutationOptions({
      onSuccess: () => {
        setFleetDirty(false);
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Fleet settings saved successfully");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save fleet settings");
      },
    })
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateFleetMutation.mutate({
      pollIntervalMs: pollIntervalSec * 1000,
      unhealthyThreshold,
      metricsRetentionDays,
    });
  };

  if (settingsQuery.isError) return <QueryError message="Failed to load fleet settings" onRetry={() => settingsQuery.refetch()} />;

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fleet Polling Configuration</CardTitle>
        <CardDescription>
          Configure how frequently VectorFlow polls fleet nodes for health status
          updates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="poll-interval">Poll Interval (seconds)</Label>
            <Input
              id="poll-interval"
              type="number"
              min={1}
              max={300}
              value={pollIntervalSec}
              onChange={(e) => { setFleetDirty(true); setPollIntervalSec(Number(e.target.value)); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              How often to check node health (1-300 seconds)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unhealthy-threshold">Unhealthy Threshold</Label>
            <Input
              id="unhealthy-threshold"
              type="number"
              min={1}
              max={100}
              value={unhealthyThreshold}
              onChange={(e) => { setFleetDirty(true); setUnhealthyThreshold(Number(e.target.value)); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              Number of consecutive failed polls before marking a node as
              unhealthy
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="metrics-retention">Metrics Retention (days)</Label>
            <Input
              id="metrics-retention"
              type="number"
              min={1}
              max={365}
              value={metricsRetentionDays}
              onChange={(e) => { setFleetDirty(true); setMetricsRetentionDays(Number(e.target.value)); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              How long to keep pipeline metrics data (1-365 days)
            </p>
          </div>

          <Button type="submit" disabled={updateFleetMutation.isPending}>
            {updateFleetMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Fleet Settings"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
