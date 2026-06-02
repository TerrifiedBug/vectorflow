"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { EmptyState } from "@/components/empty-state";
import { OnboardingChecklist } from "@/components/onboarding/onboarding-checklist";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, PageHeaderMetaSep } from "@/components/ui/page-header";
import { KpiTile } from "@/components/ui/kpi-tile";
import { MetricChart } from "@/components/ui/metric-chart";
import { Pill } from "@/components/ui/pill";
import { Sparkline } from "@/components/ui/sparkline";
import { StatusDot } from "@/components/ui/status-dot";
import { formatBytesRate, formatEventsRate, formatSI } from "@/lib/format";
import { derivePipelineStatus } from "@/lib/pipeline-status";
import { cn } from "@/lib/utils";
import { usePollingInterval } from "@/hooks/use-polling-interval";

type TimeRange = "1h" | "6h" | "1d" | "7d";
type SeriesMap = Record<string, Array<{ t: number; v: number }>>;

const TIME_RANGES: Array<{ label: string; value: TimeRange }> = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "1d" },
  { label: "7d", value: "7d" },
];

const ACTIVITY_TAG_COLORS: Record<string, string> = {
  CREATE: "var(--status-healthy)",
  UPDATE: "var(--status-info)",
  DELETE: "var(--status-error)",
  DEPLOY: "var(--accent-brand)",
};

function latestTotal(series?: SeriesMap) {
  return Object.values(series ?? {}).reduce((sum, points) => sum + (points.at(-1)?.v ?? 0), 0);
}

function flattenValues(series?: SeriesMap) {
  return Object.values(series ?? {}).flatMap((points) => points.map((point) => point.v));
}

function percentile(values: number[], p: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function sumSeries(series?: SeriesMap, fallbackLength = 24) {
  const values = Object.values(series ?? {});
  if (values.length === 0) return Array.from({ length: fallbackLength }, () => 0);
  const length = Math.max(...values.map((points) => points.length), 1);
  return Array.from({ length }, (_, index) =>
    values.reduce((sum, points) => sum + (points[index]?.v ?? 0), 0),
  );
}

function chartSeries(series?: SeriesMap, color = "var(--accent-brand)", name = "total") {
  return [{ name, color, data: sumSeries(series) }];
}

function axisLabels(values: number[], formatter: (value: number) => string) {
  const max = Math.max(...values, 0);
  return Array.from({ length: 5 }, (_, index) => formatter((max * index) / 4));
}

function pointLabels(length: number, range: TimeRange) {
  const totalMinutes = range === "1h" ? 60 : range === "6h" ? 360 : range === "1d" ? 1440 : 10080;
  if (length <= 1) return ["now"];
  return Array.from({ length }, (_, index) => {
    const minutesAgo = Math.round(((length - 1 - index) / (length - 1)) * totalMinutes);
    if (minutesAgo <= 0) return "now";
    if (minutesAgo >= 1440) return `-${Math.round(minutesAgo / 1440)}d`;
    if (minutesAgo >= 60) return `-${Math.round(minutesAgo / 60)}h`;
    return `-${minutesAgo}m`;
  });
}

function rateSparkline(seed: number, length = 24) {
  const base = Math.max(1, seed);
  return Array.from({ length }, (_, index) => {
    const wave = Math.sin((index + 1) * 0.72) * 0.18;
    const drift = (index / length) * 0.1;
    return Math.max(0, base * (0.86 + wave + drift));
  });
}


function formatRefreshAge(timestamp: number) {
  if (!timestamp) return "last refresh pending";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `last refresh ${seconds}s ago`;
  return `last refresh ${Math.floor(seconds / 60)}m ago`;
}

function formatAuditTime(value: Date | string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatPct(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function hotnessTone(value: number) {
  if (value >= 85) return "var(--status-error)";
  if (value >= 70) return "var(--status-warning)";
  return "var(--status-healthy)";
}


export default function DashboardPage() {
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [, forceRefreshAgeRender] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => forceRefreshAgeRender((value) => value + 1), 2_000);
    return () => window.clearInterval(id);
  }, []);

  const refreshInterval: Record<TimeRange, number> = {
    "1h": 5_000,
    "6h": 30_000,
    "1d": 60_000,
    "7d": 300_000,
  };
  const polling = usePollingInterval(refreshInterval[timeRange]);

  const stats = useQuery({
    ...trpc.dashboard.stats.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });
  const pipelineCards = useQuery({
    ...trpc.dashboard.pipelineCards.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });
  const chartData = useQuery({
    ...trpc.dashboard.chartMetrics.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      nodeIds: [],
      pipelineIds: [],
      range: timeRange,
      groupBy: "aggregate",
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });
  const fleetHotness = useQuery({
    ...trpc.dashboard.fleetHotness.queryOptions({ environmentId: selectedEnvironmentId ?? "", range: timeRange }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });
  const audit = useQuery({
    ...trpc.dashboard.recentAudit.queryOptions(),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });

  const dashboard = useMemo(() => {
    const eventsIn = latestTotal(chartData.data?.pipeline.eventsIn);
    const eventsOut = latestTotal(chartData.data?.pipeline.eventsOut);
    const bytesIn = latestTotal(chartData.data?.pipeline.bytesIn);
    const bytesOut = latestTotal(chartData.data?.pipeline.bytesOut);
    const errors = latestTotal(chartData.data?.pipeline.errors);
    const discarded = latestTotal(chartData.data?.pipeline.discarded);
    const latencyP99 = percentile(flattenValues(chartData.data?.pipeline.latency), 0.99);
    const reduction = eventsIn > 0
      ? Math.max(0, (1 - eventsOut / eventsIn) * 100)
      : stats.data?.reduction.percent ?? 0;
    const errorRate = eventsIn > 0 ? (errors / eventsIn) * 100 : 0;

    const pipelines = (pipelineCards.data ?? [])
      .map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        status: derivePipelineStatus(pipeline.nodes),
        events: pipeline.rates.eventsIn || pipeline.rates.eventsOut,
        bytesOut: pipeline.rates.bytesOut,
        sparkline: pipeline.sparkline.map((point) => point.eventsIn),
      }))
      .sort((a, b) => b.events - a.events);

    return {
      eventsIn,
      eventsOut,
      bytesIn,
      bytesOut,
      errors,
      discarded,
      latencyP99,
      reduction,
      errorRate,
      pipelines,
      topDestinations: [...pipelines].sort((a, b) => b.bytesOut - a.bytesOut).slice(0, 5),
    };
  }, [chartData.data, pipelineCards.data, stats.data?.reduction.percent]);

  if (!selectedEnvironmentId) {
    return <EmptyState glyph="◇" title="Select an environment" description="Choose an environment to view pipeline, fleet, and telemetry health." />;
  }

  if (stats.isError || pipelineCards.isError || chartData.isError || fleetHotness.isError || audit.isError) {
    return (
      <ErrorState
        title="Dashboard data unavailable"
        body="Failed to load dashboard data. The current route and environment selection are unchanged."
        primary={{
          label: "Try again",
          onClick: () => {
            stats.refetch();
            pipelineCards.refetch();
            chartData.refetch();
            fleetHotness.refetch();
            audit.refetch();
          },
        }}
      />
    );
  }

  if (!stats.isPending && stats.data && stats.data.nodes === 0 && stats.data.pipelines === 0) {
    return (
      <div className="p-4">
        <OnboardingChecklist
          variant="full"
          environmentId={selectedEnvironmentId}
          agentEnrolled={stats.data.nodes > 0}
          pipelineCreated={false}
          pipelineDeployed={false}
        />
      </div>
    );
  }

  const isPending = stats.isPending || pipelineCards.isPending || chartData.isPending || fleetHotness.isPending;
  const healthyNodes = stats.data?.fleet.healthy ?? 0;
  const totalNodes = stats.data?.nodes ?? 0;
  const latestRefresh = Math.max(stats.dataUpdatedAt, pipelineCards.dataUpdatedAt, chartData.dataUpdatedAt, fleetHotness.dataUpdatedAt);
  const maxDestinationBytes = Math.max(1, ...dashboard.topDestinations.map((pipeline) => pipeline.bytesOut));
  const onboardingDeployed = dashboard.pipelines.some(
    (pipeline) => pipeline.status === "RUNNING" || pipeline.status === "STARTING",
  );

  const eventSeries = [
    ...chartSeries(chartData.data?.pipeline.eventsIn, "var(--accent-brand)", "in"),
    ...chartSeries(chartData.data?.pipeline.eventsOut, "var(--chart-2)", "out"),
  ];
  const errorSeries = [
    ...chartSeries(chartData.data?.pipeline.errors, "var(--status-error)", "errors"),
    ...chartSeries(chartData.data?.pipeline.discarded, "var(--chart-4)", "discarded"),
  ];
  const eventPointLabels = pointLabels(eventSeries[0]?.data.length ?? 0, timeRange);
  const errorPointLabels = pointLabels(errorSeries[0]?.data.length ?? 0, timeRange);

  return (
    <div role="region" aria-label="Overview" className="min-h-full bg-bg">
      <PageHeader
        title="Overview"
        subtitle="Real-time operating picture for pipeline throughput, fleet health, and recent changes."
        meta={
          <>
            <span>{healthyNodes} of {totalNodes} nodes healthy</span>
            <PageHeaderMetaSep />
            <span>{formatRefreshAge(latestRefresh)}</span>
            <PageHeaderMetaSep />
            <span>auto</span>
            <PageHeaderMetaSep />
            <span>{timeRange === "1h" ? "5s" : timeRange === "6h" ? "30s" : timeRange === "1d" ? "60s" : "5m"}</span>
          </>
        }
        actions={
          <div className="flex overflow-hidden rounded-[3px] border border-line bg-bg-2">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                type="button"
                onClick={() => setTimeRange(range.value)}
                className={cn(
                  "h-8 px-2.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2 transition-colors hover:text-fg",
                  timeRange === range.value && "bg-accent-soft text-accent-brand",
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-4 pt-4 empty:hidden">
        <OnboardingChecklist
          environmentId={selectedEnvironmentId}
          agentEnrolled={totalNodes > 0}
          pipelineCreated={(stats.data?.pipelines ?? 0) > 0}
          pipelineDeployed={onboardingDeployed}
        />
      </div>

      <div className="grid grid-cols-12 gap-3 p-4">
        {isPending ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="col-span-12 h-[118px] sm:col-span-6 lg:col-span-2" />
          ))
        ) : (
          <>
            <KpiTile
              className="col-span-12 min-h-[118px] sm:col-span-6 lg:col-span-2"
              label="Events/sec"
              value={formatEventsRate(dashboard.eventsIn)}
              sub={`out ${formatEventsRate(dashboard.eventsOut)}`}
              trend={<Sparkline data={sumSeries(chartData.data?.pipeline.eventsIn)} width={88} height={24} />}
            />
            <KpiTile
              className="col-span-12 min-h-[118px] sm:col-span-6 lg:col-span-2"
              label="Bytes/sec"
              value={formatBytesRate(dashboard.bytesIn)}
              sub={`out ${formatBytesRate(dashboard.bytesOut)}`}
              trend={<Sparkline data={sumSeries(chartData.data?.pipeline.bytesIn)} width={88} height={24} color="var(--chart-2)" />}
              accent="var(--chart-2)"
            />
            <KpiTile
              className="col-span-12 min-h-[118px] sm:col-span-6 lg:col-span-2"
              label="Log reduction"
              value={`${dashboard.reduction.toFixed(0)}%`}
              sub="last hour"
              trend={<Sparkline data={rateSparkline(dashboard.reduction)} width={88} height={24} />}
              accent={dashboard.reduction > 0 ? "var(--accent-brand)" : undefined}
            />
            <KpiTile
              className="col-span-12 min-h-[118px] sm:col-span-6 lg:col-span-2"
              label="Error rate"
              value={`${dashboard.errorRate.toFixed(2)}%`}
              sub={`${formatSI(dashboard.errors)}/s errors`}
              trend={<Sparkline data={sumSeries(chartData.data?.pipeline.errors)} width={88} height={24} color="var(--status-error)" />}
              accent={dashboard.errorRate > 1 ? "var(--status-error)" : undefined}
            />
            <KpiTile
              className="col-span-12 min-h-[118px] sm:col-span-6 lg:col-span-2"
              label="P99 latency"
              value={dashboard.latencyP99 ? `${dashboard.latencyP99.toFixed(0)}` : "—"}
              unit={dashboard.latencyP99 ? "ms" : undefined}
              sub="observed buckets"
              trend={<Sparkline data={sumSeries(chartData.data?.pipeline.latency)} width={88} height={24} color="var(--chart-4)" />}
              accent="var(--chart-4)"
            />
            <KpiTile
              className="col-span-12 min-h-[118px] sm:col-span-6 lg:col-span-2"
              label="Nodes"
              value={`${healthyNodes}/${totalNodes}`}
              sub={`${stats.data?.fleet.degraded ?? 0} degraded · ${stats.data?.fleet.unreachable ?? 0} down`}
              trend={<Sparkline data={rateSparkline(healthyNodes)} width={88} height={24} />}
            />
          </>
        )}

        <section className="col-span-12 rounded-[3px] border border-line bg-bg-2 lg:col-span-8">
          <TileHeader title="Events · in / out per second" legend={["in", "out"]} />
          <div className="overflow-hidden px-[14px] pb-[14px]">
            <MetricChart
              width={820}
              height={250}
              className="h-[250px] w-full"
              series={eventSeries}
              yLabels={axisLabels(eventSeries.flatMap((series) => series.data), formatEventsRate)}
              xLabels={["-60m", "-45m", "-30m", "-15m", "now"]}
              pointLabels={eventPointLabels}
              valueFormatter={formatEventsRate}
            />
          </div>
        </section>

        <section className="col-span-12 rounded-[3px] border border-line bg-bg-2 lg:col-span-4">
          <TileHeader title="Pipelines" />
          <div className="divide-y divide-line px-[14px] pb-[14px]">
            {dashboard.pipelines.slice(0, 5).map((pipeline) => (
              <div key={pipeline.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 py-2.5">
                <StatusDot variant={pipeline.status === "CRASHED" ? "error" : pipeline.status === "STOPPED" ? "neutral" : "healthy"} size={6} />
                <Link href={`/pipelines/${pipeline.id}`} className="truncate font-mono text-[12px] text-fg hover:underline">
                  {pipeline.name}
                </Link>
                <Sparkline data={pipeline.sparkline.length ? pipeline.sparkline : rateSparkline(pipeline.events)} width={74} height={20} fill={false} />
                <span className="font-mono text-[11px] tabular-nums text-fg-2">{formatEventsRate(pipeline.events)}</span>
              </div>
            ))}
            {dashboard.pipelines.length === 0 && (
              <div className="py-6 font-mono text-[11px] text-fg-2">No deployed pipelines.</div>
            )}
          </div>
        </section>

        <section className="col-span-12 rounded-[3px] border border-line bg-bg-2 lg:col-span-4">
          <TileHeader title="Errors & discarded" legend={["errors", "discarded"]} />
          <div className="overflow-hidden px-[14px] pb-[14px]">
            <MetricChart
              width={390}
              height={190}
              className="h-[190px] w-full"
              series={errorSeries}
              yLabels={axisLabels(errorSeries.flatMap((series) => series.data), formatSI)}
              xLabels={["", "", "now"]}
              pointLabels={errorPointLabels}
              valueFormatter={formatSI}
            />
          </div>
        </section>

        <section className="col-span-12 rounded-[3px] border border-line bg-bg-2 lg:col-span-4">
          <TileHeader title="Fleet hotness" />
          <div className="space-y-4 px-[14px] pb-[14px]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[3px] border border-line bg-bg px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">Avg CPU</div>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <span className="font-mono text-[22px] leading-none tabular-nums text-fg">
                    {formatPct(fleetHotness.data?.averages.cpuPct ?? 0)}
                  </span>
                  <Sparkline data={fleetHotness.data?.series.cpu ?? []} width={56} height={20} fill={false} color="var(--accent-brand)" />
                </div>
              </div>
              <div className="rounded-[3px] border border-line bg-bg px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">Avg MEM</div>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <span className="font-mono text-[22px] leading-none tabular-nums text-fg">
                    {formatPct(fleetHotness.data?.averages.memoryPct ?? 0)}
                  </span>
                  <Sparkline data={fleetHotness.data?.series.memory ?? []} width={56} height={20} fill={false} color="var(--chart-2)" />
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {(fleetHotness.data?.nodes ?? []).slice(0, 3).map((node) => {
                const tone = hotnessTone(node.hotness);
                return (
                  <Link key={node.nodeId} href={`/fleet/${node.nodeId}`} className="block space-y-1.5 rounded-[3px] border border-transparent px-1 py-0.5 hover:border-line hover:bg-bg">
                    <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
                      <span className="truncate text-fg">{node.nodeName}</span>
                      <span className="tabular-nums" style={{ color: tone }}>{formatPct(node.hotness)}</span>
                    </div>
                    <div className="grid grid-cols-[32px_1fr_42px] items-center gap-2 font-mono text-[10px] text-fg-3">
                      <span>CPU</span>
                      <div className="h-1.5 overflow-hidden rounded-full bg-bg-4">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(3, node.cpuPct))}%`, background: hotnessTone(node.cpuPct) }} />
                      </div>
                      <span className="text-right tabular-nums">{formatPct(node.cpuPct)}</span>
                      <span>MEM</span>
                      <div className="h-1.5 overflow-hidden rounded-full bg-bg-4">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(3, node.memoryPct))}%`, background: hotnessTone(node.memoryPct) }} />
                      </div>
                      <span className="text-right tabular-nums">{formatPct(node.memoryPct)}</span>
                    </div>
                  </Link>
                );
              })}
              {(fleetHotness.data?.nodes ?? []).length === 0 && (
                <div className="py-6 font-mono text-[11px] text-fg-2">No node metrics yet.</div>
              )}
            </div>
          </div>
        </section>

        <section className="col-span-12 rounded-[3px] border border-line bg-bg-2 lg:col-span-4">
          <TileHeader title="Top destinations" />
          <div className="space-y-3 px-[14px] pb-[14px]">
            {dashboard.topDestinations.map((destination) => (
              <div key={destination.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
                  <span className="truncate text-fg">{destination.name}</span>
                  <span className="tabular-nums text-fg-2">{formatBytesRate(destination.bytesOut)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-bg-4">
                  <div
                    className="h-full rounded-full bg-accent-brand"
                    style={{ width: `${Math.max(4, (destination.bytesOut / maxDestinationBytes) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {dashboard.topDestinations.length === 0 && (
              <div className="py-6 font-mono text-[11px] text-fg-2">No sink throughput yet.</div>
            )}
          </div>
        </section>

        <section className="col-span-12 rounded-[3px] border border-line bg-bg-2 lg:col-span-8">
          <TileHeader title="Activity" />
          <div className="divide-y divide-line px-[14px] pb-[14px]">
            {(audit.data ?? []).slice(0, 7).map((entry) => {
              const action = entry.action.split("_")[0] ?? "EVENT";
              return (
                <div key={entry.id} className="grid grid-cols-[64px_96px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 font-mono text-[11px]">
                  <span className="tabular-nums text-fg-2">{formatAuditTime(entry.createdAt)}</span>
                  <Pill size="xs" color={ACTIVITY_TAG_COLORS[action] ?? "var(--fg-2)"} className="max-w-[96px] truncate">
                    {action}
                  </Pill>
                  <span className="truncate text-fg-1">{entry.action.toLowerCase().replaceAll("_", " ")} · {entry.entityType}</span>
                  <span className="truncate text-fg-2">{entry.user?.name ?? entry.user?.email ?? "system"}</span>
                </div>
              );
            })}
            {(audit.data ?? []).length === 0 && (
              <div className="py-6 font-mono text-[11px] text-fg-2">No recent activity.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TileHeader({ title, legend }: { title: string; legend?: string[] }) {
  return (
    <div className="flex items-center justify-between gap-3 px-[14px] py-3">
      <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-fg">{title}</h2>
      {legend && (
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
          {legend.map((label, index) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: index === 0 ? "var(--accent-brand)" : "var(--chart-2)" }}
              />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
