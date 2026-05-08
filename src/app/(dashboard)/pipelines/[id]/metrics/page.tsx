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
import { PageHeader, PageHeaderMetaSep } from "@/components/ui/page-header";

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
  const [minutes, setMinutes] = useState(1440);

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
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title={`${pipeline?.name ?? "Pipeline"} metrics`}
        subtitle="Throughput, error, latency, and live log signals for this pipeline."
        meta={
          <>
            <span>{rows.length} metric buckets</span>
            <PageHeaderMetaSep />
            <span>refreshes every 15s</span>
          </>
        }
        actions={
          <div className="flex gap-1">
            {TIME_RANGES.map((tr) => (
              <Button
                key={tr.label}
                variant={minutes === tr.minutes ? "default" : "outline"}
                size="sm"
                onClick={() => setMinutes(tr.minutes)}
                className="font-mono text-[11px]"
              >
                {tr.label}
              </Button>
            ))}
          </div>
        }
      />
      <div className="space-y-4 p-4">

        <SummaryCards rows={rows} />

        {rows.length === 0 ? (

        <Card className="border-line bg-bg-2">
          <CardContent className="py-12">
            <EmptyState
              glyph="∿"
              title="No metric samples in this window"
              description="The pipeline loaded, but no metric buckets were returned for the selected range. Check that the pipeline is deployed, the assigned agent is online, or widen the time window."
              action={{ label: "Show 24h", onClick: () => setMinutes(1440) }}
              secondary={{ label: "Open editor", href: `/pipelines/${params.id}/edit` }}
              helperLines={[
                { icon: "$", text: "Metrics query is live; this is an empty result, not a failed load." },
                { icon: "→", text: "Pipeline logs remain available below for agent-side diagnostics." },
              ]}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-line bg-bg-2">
            <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
              <CardTitle className="font-mono text-[12px] uppercase tracking-[0.06em]">Events throughput</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <MetricsChart rows={rows} dataKey="events" height={220} />
            </CardContent>
          </Card>

          <Card className="border-line bg-bg-2">
            <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
              <CardTitle className="font-mono text-[12px] uppercase tracking-[0.06em]">Data throughput</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <MetricsChart rows={rows} dataKey="bytes" height={220} />
            </CardContent>
          </Card>

          <Card className="border-line bg-bg-2">
            <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
              <CardTitle className="font-mono text-[12px] uppercase tracking-[0.06em]">Errors & discarded events</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <MetricsChart rows={rows} dataKey="errors" height={220} />
            </CardContent>
          </Card>

          <Card className="border-line bg-bg-2">
            <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
              <CardTitle className="font-mono text-[12px] uppercase tracking-[0.06em]">Transform latency</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <TransformLatencyChart
                components={componentLatencyQuery.data?.components ?? {}}
                height={220}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Pipeline Logs */}
      <Card className="border-line bg-bg-2">
        <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
          <CardTitle className="font-mono text-[12px] uppercase tracking-[0.06em]">Logs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[400px]">
            <PipelineLogs pipelineId={params.id} />
          </div>
        </CardContent>
      </Card>
      </div>
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
        <XAxis dataKey="time" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
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
