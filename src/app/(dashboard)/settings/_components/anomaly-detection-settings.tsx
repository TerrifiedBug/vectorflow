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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";

// ─── Sensitivity presets ────────────────────────────────────────────────────

const SENSITIVITY_PRESETS = [
  { label: "Sensitive", value: "2", sigma: 2 },
  { label: "Moderate", value: "2.5", sigma: 2.5 },
  { label: "Balanced", value: "3", sigma: 3 },
  { label: "Relaxed", value: "4", sigma: 4 },
] as const;

function sigmaToPreset(sigma: number): string {
  const match = SENSITIVITY_PRESETS.find((p) => p.sigma === sigma);
  return match ? match.value : "custom";
}

// ─── Metric helpers ─────────────────────────────────────────────────────────

interface MetricToggles {
  eventsIn: boolean;
  errorsTotal: boolean;
  latencyMeanMs: boolean;
}

function parseEnabledMetrics(csv: string): MetricToggles {
  const set = new Set(csv.split(",").map((s) => s.trim()));
  return {
    eventsIn: set.has("eventsIn"),
    errorsTotal: set.has("errorsTotal"),
    latencyMeanMs: set.has("latencyMeanMs"),
  };
}

function serializeEnabledMetrics(toggles: MetricToggles): string {
  return (["eventsIn", "errorsTotal", "latencyMeanMs"] as const)
    .filter((m) => toggles[m])
    .join(",");
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AnomalyDetectionSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  // Form state
  const [sigmaThreshold, setSigmaThreshold] = useState(3);
  const [baselineWindowDays, setBaselineWindowDays] = useState(7);
  const [dedupWindowHours, setDedupWindowHours] = useState(4);
  const [minStddevFloor, setMinStddevFloor] = useState(5);
  const [enabledMetrics, setEnabledMetrics] = useState<MetricToggles>({
    eventsIn: true,
    errorsTotal: true,
    latencyMeanMs: true,
  });
  const [dirty, setDirty] = useState(false);

  // Sync server state to form (preserve dirty state)
  useEffect(() => {
    if (!settings) return;
    if (dirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSigmaThreshold(settings.anomalySigmaThreshold);
    setBaselineWindowDays(settings.anomalyBaselineWindowDays);
    setDedupWindowHours(settings.anomalyDedupWindowHours);
    setMinStddevFloor(settings.anomalyMinStddevFloorPercent);
    setEnabledMetrics(parseEnabledMetrics(settings.anomalyEnabledMetrics));
  }, [settings, dirty]);

  const updateMutation = useMutation(
    trpc.settings.updateAnomalyConfig.mutationOptions({
      onSuccess: (result) => {
        // Hydrate form state directly from the mutation response so the values
        // can't be clobbered by a stale `settings` snapshot in the useEffect
        // sync (the `dirty` toggle re-runs the effect before the refetch
        // resolves, which previously made saves appear to revert).
        setSigmaThreshold(result.anomalySigmaThreshold);
        setBaselineWindowDays(result.anomalyBaselineWindowDays);
        setDedupWindowHours(result.anomalyDedupWindowHours);
        setMinStddevFloor(result.anomalyMinStddevFloorPercent);
        setEnabledMetrics(parseEnabledMetrics(result.anomalyEnabledMetrics));
        setDirty(false);
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Anomaly detection settings saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save anomaly detection settings", { duration: 6000 });
      },
    })
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      baselineWindowDays,
      sigmaThreshold,
      minStddevFloorPercent: minStddevFloor,
      dedupWindowHours,
      enabledMetrics: serializeEnabledMetrics(enabledMetrics),
    });
  };

  const noMetricsEnabled = !enabledMetrics.eventsIn && !enabledMetrics.errorsTotal && !enabledMetrics.latencyMeanMs;
  const sensitivityPreset = sigmaToPreset(sigmaThreshold);

  if (settingsQuery.isError) {
    return <QueryError message="Failed to load anomaly detection settings" onRetry={() => settingsQuery.refetch()} />;
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Detection Sensitivity</CardTitle>
          <CardDescription>
            Control how aggressively VectorFlow flags deviations from baseline
            metric behavior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            {/* Sensitivity preset */}
            <div className="space-y-2">
              <Label htmlFor="sensitivity">Sensitivity</Label>
              <Select
                value={sensitivityPreset}
                onValueChange={(val) => {
                  setDirty(true);
                  if (val === "custom") return;
                  setSigmaThreshold(Number(val));
                }}
              >
                <SelectTrigger id="sensitivity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENSITIVITY_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label} ({p.sigma} sigma)
                    </SelectItem>
                  ))}
                  {sensitivityPreset === "custom" && (
                    <SelectItem value="custom">
                      Custom ({sigmaThreshold} sigma)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {sensitivityPreset === "custom" && (
                <Input
                  type="number"
                  min={1.5}
                  max={5}
                  step={0.5}
                  value={sigmaThreshold}
                  onChange={(e) => { setDirty(true); setSigmaThreshold(Number(e.target.value)); }}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Lower values detect smaller deviations (more alerts); higher values require larger deviations (fewer alerts)
              </p>
            </div>

            {/* Baseline window */}
            <div className="space-y-2">
              <Label htmlFor="baseline-window">Baseline Window</Label>
              <Select
                value={String(baselineWindowDays)}
                onValueChange={(val) => { setDirty(true); setBaselineWindowDays(Number(val)); }}
              >
                <SelectTrigger id="baseline-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How much historical data to use when computing the expected baseline
              </p>
            </div>

            {/* Dedup cooldown */}
            <div className="space-y-2">
              <Label htmlFor="dedup-window">Dedup Cooldown</Label>
              <Select
                value={String(dedupWindowHours)}
                onValueChange={(val) => { setDirty(true); setDedupWindowHours(Number(val)); }}
              >
                <SelectTrigger id="dedup-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="4">4 hours</SelectItem>
                  <SelectItem value="12">12 hours</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Suppresses duplicate alerts for the same pipeline and anomaly type within this window
              </p>
            </div>

            {/* Min stddev floor */}
            <div className="space-y-2">
              <Label htmlFor="stddev-floor">Min Standard Deviation Floor (%)</Label>
              <Input
                id="stddev-floor"
                type="number"
                min={1}
                max={25}
                value={minStddevFloor}
                onChange={(e) => { setDirty(true); setMinStddevFloor(Number(e.target.value)); }}
                required
              />
              <p className="text-xs text-muted-foreground">
                Prevents false positives on constant metrics. A 5% floor means a metric at 1000 must
                deviate by at least 50 x sigma to trigger.
              </p>
            </div>

            <Button type="submit" disabled={updateMutation.isPending || noMetricsEnabled}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Anomaly Settings"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Monitored metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Monitored Metrics</CardTitle>
          <CardDescription>
            Choose which pipeline metrics are evaluated for anomalies. At least one must be enabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="metric-throughput">Throughput</Label>
                <p className="text-xs text-muted-foreground">Detect spikes and drops in events per interval</p>
              </div>
              <Switch
                id="metric-throughput"
                checked={enabledMetrics.eventsIn}
                onCheckedChange={(checked) => {
                  setDirty(true);
                  setEnabledMetrics((prev) => ({ ...prev, eventsIn: checked }));
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="metric-errors">Error Rate</Label>
                <p className="text-xs text-muted-foreground">Detect spikes in error count per interval</p>
              </div>
              <Switch
                id="metric-errors"
                checked={enabledMetrics.errorsTotal}
                onCheckedChange={(checked) => {
                  setDirty(true);
                  setEnabledMetrics((prev) => ({ ...prev, errorsTotal: checked }));
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="metric-latency">Latency</Label>
                <p className="text-xs text-muted-foreground">Detect spikes in mean latency (ms)</p>
              </div>
              <Switch
                id="metric-latency"
                checked={enabledMetrics.latencyMeanMs}
                onCheckedChange={(checked) => {
                  setDirty(true);
                  setEnabledMetrics((prev) => ({ ...prev, latencyMeanMs: checked }));
                }}
              />
            </div>

            {noMetricsEnabled && (
              <p className="text-sm text-destructive">At least one metric must be enabled</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
