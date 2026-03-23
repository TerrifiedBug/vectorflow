"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCards } from "@/components/metrics/summary-cards";
import { MetricsChart } from "@/components/metrics/component-chart";
import { PipelineLogs } from "@/components/pipeline/pipeline-logs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatLatency } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

const TIME_RANGES = [
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
] as const;

export default function PipelineMetricsPage() {
  const params = useParams<{ id: string }>();
  const trpc = useTRPC();
  const [minutes, setMinutes] = useState(60);

  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: params.id }),
  );

  const metricsQuery = useQuery(
    trpc.metrics.getPipelineMetrics.queryOptions(
      { pipelineId: params.id, minutes },
      { refetchInterval: 15000 },
    ),
  );

  const componentLatencyQuery = useQuery(
    trpc.metrics.getComponentLatencyHistory.queryOptions(
      { pipelineId: params.id, minutes },
      { refetchInterval: 15000 },
    ),
  );

  if (pipelineQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  if (pipelineQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError message="Failed to load pipeline metrics" onRetry={() => pipelineQuery.refetch()} />
      </div>
    );
  }

  const pipeline = pipelineQuery.data;
  const rows = metricsQuery.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {pipeline?.name ?? "Pipeline"} — Metrics
          </h2>
          <p className="text-muted-foreground">
            Pipeline throughput and performance
          </p>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <Button
              key={tr.label}
              variant={minutes === tr.minutes ? "default" : "outline"}
              size="sm"
              onClick={() => setMinutes(tr.minutes)}
            >
              {tr.label}
            </Button>
          ))}
        </div>
      </div>

      <SummaryCards rows={rows} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="No metrics data available yet"
              description="Metrics appear after the pipeline is deployed and agents begin reporting heartbeats."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Events Throughput</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsChart rows={rows} dataKey="events" height={220} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data Throughput</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsChart rows={rows} dataKey="bytes" height={220} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Errors & Discarded Events</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsChart rows={rows} dataKey="errors" height={220} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transform Latency</CardTitle>
            </CardHeader>
            <CardContent>
              <TransformLatencyChart
                components={componentLatencyQuery.data?.components ?? {}}
                height={220}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Pipeline Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[400px]">
            <PipelineLogs pipelineId={params.id} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Deterministic color palette for per-component latency lines
const LATENCY_COLORS = [
  "#ec4899", "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#6366f1", "#14b8a6", "#f97316",
];

function TransformLatencyChart({
  components,
  height = 220,
}: {
  components: Record<string, Array<{ timestamp: Date; latencyMeanMs: number }>>;
  height?: number;
}) {
  const { data, config, componentIds } = useMemo(() => {
    const ids = Object.keys(components).sort();
    if (ids.length === 0) return { data: [], config: {} as ChartConfig, componentIds: [] };

    // Collect all unique timestamps (keyed by epoch ms for correct sorting)
    const timeMap = new Map<number, Record<string, number>>();
    for (const id of ids) {
      for (const point of components[id]) {
        const ms = new Date(point.timestamp).getTime();
        const entry = timeMap.get(ms) ?? {};
        entry[id] = point.latencyMeanMs;
        timeMap.set(ms, entry);
      }
    }

    // Build chart data sorted by timestamp, display as locale time
    const chartData = Array.from(timeMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([ms, values]) => ({
        time: new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ...values,
      }));

    // Build chart config with deterministic colors
    const chartConfig: ChartConfig = {};
    for (let i = 0; i < ids.length; i++) {
      chartConfig[ids[i]] = {
        label: ids[i],
        color: LATENCY_COLORS[i % LATENCY_COLORS.length],
      };
    }

    return { data: chartData, config: chartConfig, componentIds: ids };
  }, [components]);

  if (data.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        <p className="text-sm">No transform latency data yet</p>
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 10 }}
          width={55}
          tickFormatter={(v) => formatLatency(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="font-mono font-medium text-foreground">
                    {formatLatency(Number(value) ?? 0)}
                  </span>
                </div>
              )}
            />
          }
        />
        {componentIds.map((id) => (
          <Line
            key={id}
            type="monotone"
            dataKey={id}
            name={id}
            stroke={config[id]?.color ?? "#888"}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
