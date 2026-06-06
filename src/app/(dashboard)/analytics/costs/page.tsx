// src/app/(dashboard)/analytics/costs/page.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight, DollarSign } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { ChartSkeleton, KpiSkeleton, TableSkeleton } from "@/components/ui/loading-skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CostTeamRollup } from "@/components/analytics/cost-team-rollup";
import { CostEnvironmentRollup } from "@/components/analytics/cost-environment-rollup";
import { CostCsvExport } from "@/components/analytics/cost-csv-export";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { formatBytes, formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import type { CostSummaryResult, CostTimeSeriesBucket, PipelineCostRow } from "@/server/services/cost-attribution";

type CostRange = "1d" | "7d" | "30d";

function CostAnalyticsSectionNav() {
  return (
    <nav
      aria-label="Analytics sections"
      className="inline-flex h-[34px] items-center gap-1 rounded-[3px] border border-line bg-bg-2 p-[3px]"
    >
      <Link
        href="/analytics"
        className="inline-flex h-full items-center rounded-[3px] border border-transparent px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-fg-2 transition-colors hover:bg-bg-3 hover:text-fg"
      >
        Volume
      </Link>
      <Link
        href="/analytics/costs"
        aria-current="page"
        className="inline-flex h-full items-center rounded-[3px] border border-line-2 bg-bg-1 px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-fg"
      >
        Costs
      </Link>
    </nav>
  );
}

/**
 * v2 cost & savings dashboard (D7): hero savings band, raw-vs-reduced trend, technique bars, and dense by-pipeline table.
 */
export function CostDashboard() {
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const [range, setRange] = useState<CostRange>("7d");
  const [tab, setTab] = useState("pipelines");

  const pollingBase = range === "1d" ? 60_000 : 120_000;
  const pollingInterval = usePollingInterval(pollingBase);

  const summary = useQuery({
    ...trpc.analytics.costSummary.queryOptions({ environmentId: selectedEnvironmentId ?? "", range }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: pollingInterval,
  });

  const lakeStatus = useQuery(trpc.lake.status.queryOptions());

  const pipelineCosts = useQuery({
    ...trpc.analytics.costByPipeline.queryOptions({ environmentId: selectedEnvironmentId ?? "", range }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: pollingInterval,
  });

  const timeSeries = useQuery({
    ...trpc.analytics.costTimeSeries.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
      groupBy: tab === "teams" ? "team" : "pipeline",
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: pollingInterval,
  });

  const teamCosts = useQuery({
    ...trpc.analytics.costByTeam.queryOptions({ environmentId: selectedEnvironmentId ?? "", range }),
    enabled: !!selectedEnvironmentId && tab === "teams",
    refetchInterval: pollingInterval,
  });

  const envCosts = useQuery({
    ...trpc.analytics.costByEnvironment.queryOptions({ environmentId: selectedEnvironmentId ?? "", range }),
    enabled: !!selectedEnvironmentId && tab === "environments",
    refetchInterval: pollingInterval,
  });

  const current = summary.data?.current;
  const savings = current ? calculateSavings(current) : null;
  const rows = pipelineCosts.data ?? [];
  const techniqueRows = useMemo(() => buildTechniqueRows(savings?.savedCents ?? 0, savings?.savedBytes ?? 0), [savings]);

  if (!selectedEnvironmentId) {
    return (
      <div className="min-h-full bg-bg text-fg">
        <PageHeader
          title="Cost & savings"
          subtitle="What VectorFlow saves by pipeline and technique, compared against forwarding every event raw to downstream sinks."
        />
        <div className="space-y-4 p-4">
          <CostAnalyticsSectionNav />
          <EmptyState title="Select an environment to view cost analytics" />
        </div>
      </div>
    );
  }

  if (summary.isError) {
    return (
      <div className="min-h-full bg-bg text-fg">
        <PageHeader
          title="Cost & savings"
          subtitle="What VectorFlow saves by pipeline and technique, compared against forwarding every event raw to downstream sinks."
        />
        <div className="space-y-4 p-4">
          <CostAnalyticsSectionNav />
          <QueryError
            message="Failed to load cost analytics"
            onRetry={() => {
              void summary.refetch();
              void pipelineCosts.refetch();
            }}
          />
        </div>
      </div>
    );
  }

  if (summary.isLoading) {
    return (
      <div className="min-h-full bg-bg text-fg">
        <PageHeader
          title="Cost & savings"
          subtitle="What VectorFlow saves by pipeline and technique, compared against forwarding every event raw to downstream sinks."
        />
        <div className="space-y-4 p-4">
          <CostAnalyticsSectionNav />
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <KpiSkeleton key={index} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <TableSkeleton rows={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Cost & savings"
        subtitle="What VectorFlow saves by pipeline and technique, compared against forwarding every event raw to downstream sinks."
        actions={
          <>
            <CostCsvExport environmentId={selectedEnvironmentId} range={range} />
            <TimeRangeSelector ranges={["1d", "7d", "30d"] as const} value={range} onChange={setRange} />
          </>
        }
      />

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CostAnalyticsSectionNav />
        </div>

      <HeroBand summary={summary.data ?? null} range={range} lakeEnabled={lakeStatus.data?.enabled ?? false} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <RawReducedTrend data={timeSeries.data ?? []} range={range} isLoading={timeSeries.isLoading} />
        <TechniquePanel rows={techniqueRows} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pipelines" className="font-mono text-[11px] uppercase tracking-[0.04em]">By pipeline</TabsTrigger>
          <TabsTrigger value="teams" className="font-mono text-[11px] uppercase tracking-[0.04em]">By team</TabsTrigger>
          <TabsTrigger value="environments" className="font-mono text-[11px] uppercase tracking-[0.04em]">By environment</TabsTrigger>
        </TabsList>

        <TabsContent value="pipelines" className="space-y-3">
          <PipelineSavingsTable rows={rows} isLoading={pipelineCosts.isLoading} />
        </TabsContent>
        <TabsContent value="teams">
          <CostTeamRollup rows={teamCosts.data ?? []} isLoading={teamCosts.isLoading} />
        </TabsContent>
        <TabsContent value="environments">
          <CostEnvironmentRollup rows={envCosts.data ?? []} isLoading={envCosts.isLoading} />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}

function HeroBand({ summary, range, lakeEnabled }: { summary: CostSummaryResult | null; range: CostRange; lakeEnabled: boolean }) {
  const current = summary?.current;
  const previous = summary?.previous;
  const savings = current ? calculateSavings(current) : null;
  const spendTrend = current && previous ? trendPercent(current.costCents, previous.costCents) : null;
  const dollarsPerGb = current && current.bytesIn > 0 ? current.costCents / 100 / (current.bytesIn / 1_073_741_824) : 0;

  return (
    <Card className="overflow-hidden border-line bg-bg-2">
      <CardContent className="grid gap-0 p-0 lg:grid-cols-[minmax(300px,1.4fr)_repeat(4,minmax(140px,1fr))]">
        <div className="border-b border-line bg-bg-1 p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-2">
            <DollarSign className="h-3.5 w-3.5" />
            estimated saved · {range}
          </div>
          <div className="mt-3 font-mono text-[52px] font-medium leading-none tracking-[-0.04em] text-accent-brand">
            {savings ? displayCost(savings.savedCents) : "$0.00"}
          </div>
          <p className="mt-3 max-w-[520px] text-[12px] leading-relaxed text-fg-1">
            Savings are estimated from raw bytes processed minus reduced bytes shipped, using the environment cost-per-GB setting.
            {lakeEnabled && (
              <>
                {" "}
                Managed VectorFlow Lake storage is excluded from egress and cost —
                its volume is tracked separately on the{" "}
                <Link href="/lake" className="underline underline-offset-2 hover:text-fg">
                  Lake
                </Link>{" "}
                surface.
              </>
            )}
          </p>
        </div>
        <HeroMetric label="GB processed" value={current ? formatGb(current.bytesIn) : "—"} sub={trendLabel(trendPercent(current?.bytesIn ?? 0, previous?.bytesIn ?? 0))} />
        <HeroMetric label="Projected / yr" value={savings ? displayCost(savings.savedCents * (range === "1d" ? 365 : range === "7d" ? 52 : 12)) : "$0.00"} sub="at current pace" />
        <HeroMetric label="GB shipped" value={current ? formatGb(current.bytesOut) : "—"} sub={`${savings?.reductionPercent.toFixed(1) ?? "0.0"}% reduced`} />
        <HeroMetric label="$/GB" value={dollarsPerGb > 0 ? `$${dollarsPerGb.toFixed(2)}` : "—"} sub={trendLabel(spendTrend, "spend")} />
      </CardContent>
    </Card>
  );
}

function HeroMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-b border-line p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-2">{label}</div>
      <div className="mt-2 font-mono text-[24px] font-medium text-fg">{value}</div>
      <div className="mt-1 font-mono text-[11px] text-fg-2">{sub}</div>
    </div>
  );
}

function RawReducedTrend({ data, range, isLoading }: { data: CostTimeSeriesBucket[]; range: string; isLoading: boolean }) {
  const points = useMemo(() => flattenSeries(data), [data]);
  return (
    <Card className="border-line bg-bg-2">
      <CardHeader className="border-b border-line bg-bg-1 py-3">
        <CardTitle className="font-mono text-[14px] font-medium">Raw vs reduced spend · {range}</CardTitle>
        <CardDescription>raw forwarding spend (would-be) vs reduced delivery spend (actual)</CardDescription>
        <CardAction>
          <div className="flex gap-4 font-mono text-[11px] text-fg-2">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-fg-2" />raw spend</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-accent-brand" />reduced spend</span>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <ChartSkeleton />
        ) : points.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center font-mono text-[11.5px] text-fg-2">No spend data for selected range.</div>
        ) : (
          <SpendSvg points={points} range={range} />
        )}
      </CardContent>
    </Card>
  );
}

export function SpendSvg({ points, range }: { points: Array<{ t: number; rawSpendCents: number; reducedSpendCents: number }>; range: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const width = 760;
  const height = 260;
  const pad = 28;
  const max = Math.max(...points.flatMap((p) => [p.rawSpendCents, p.reducedSpendCents]), 1);
  const x = (index: number) => pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const rawPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rawSpendCents).toFixed(1)}`).join(" ");
  const reducedPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.reducedSpendCents).toFixed(1)}`).join(" ");
  const area = `${reducedPath} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  const first = new Date(points[0].t).toLocaleDateString([], { month: "short", day: "numeric" });
  const last = new Date(points[points.length - 1].t).toLocaleDateString([], { month: "short", day: "numeric" });
  const hoveredPoint = hoverIndex == null ? null : points[hoverIndex];

  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] min-w-[640px] w-full" role="img" aria-label={`Raw and reduced spend over ${range}`}>
        {Array.from({ length: 5 }).map((_, index) => {
          const gy = pad + index * ((height - pad * 2) / 4);
          return <line key={index} x1={pad} x2={width - pad} y1={gy} y2={gy} stroke="var(--line)" strokeDasharray="2 4" />;
        })}
        <path d={area} fill="var(--accent-brand)" opacity="0.14" />
        <path d={rawPath} fill="none" stroke="var(--fg-2)" strokeDasharray="5 5" strokeWidth="1.5" />
        <path d={reducedPath} fill="none" stroke="var(--accent-brand)" strokeWidth="2" />
        {hoverIndex != null && (
          <line
            x1={x(hoverIndex)}
            x2={x(hoverIndex)}
            y1={pad}
            y2={height - pad}
            stroke="var(--line-2)"
            strokeDasharray="3 3"
          />
        )}
        <rect
          data-testid="spend-chart-hitbox"
          x={pad}
          y={pad}
          width={width - pad * 2}
          height={height - pad * 2}
          fill="transparent"
          onMouseLeave={() => {
            setHoverIndex(null);
            setTooltipPosition(null);
          }}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = event.clientX - rect.left;
            const index = Math.min(
              Math.max(Math.round((relativeX / rect.width) * Math.max(points.length - 1, 1)), 0),
              Math.max(points.length - 1, 0),
            );
            setHoverIndex(index);
            setTooltipPosition({ x: relativeX, y: event.clientY - rect.top });
          }}
        />
        <text x={pad} y={height - 6} className="fill-fg-2 font-mono text-[10px]">{first}</text>
        <text x={width - pad} y={height - 6} textAnchor="end" className="fill-fg-2 font-mono text-[10px]">{last}</text>
        <text x={width - pad} y={18} textAnchor="end" className="fill-fg-2 font-mono text-[10px]">max {displayCost(max)}</text>
      </svg>
      {hoveredPoint && tooltipPosition && (
        <div
          className="pointer-events-none absolute z-10 min-w-[10rem] rounded-[3px] border border-line bg-bg-2 px-2.5 py-1.5 font-sans text-[12px] shadow-xl"
          style={{
            left: Math.min(Math.max(tooltipPosition.x + 12, 8), width - 180),
            top: Math.min(Math.max(tooltipPosition.y - 12, 8), height - 88),
          }}
        >
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
            {new Date(hoveredPoint.t).toLocaleDateString([], { month: "short", day: "numeric" })}
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-fg-1"><span className="h-2 w-2 rounded-[2px] bg-fg-2" />raw spend</span>
              <span className="font-mono text-fg tabular-nums">{displayCost(hoveredPoint.rawSpendCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-fg-1"><span className="h-2 w-2 rounded-[2px] bg-accent-brand" />reduced spend</span>
              <span className="font-mono text-fg tabular-nums">{displayCost(hoveredPoint.reducedSpendCents)}</span>
            </div>
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-fg-2">
        <span>{range} ago</span>
        <span>today</span>
      </div>
    </div>
  );
}

function TechniquePanel({ rows }: { rows: Array<{ label: string; amount: number; percent: number }> }) {
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return (
    <Card className="border-line bg-bg-2">
      <CardHeader className="border-b border-line bg-bg-1 py-3">
        <CardTitle className="font-mono text-[14px] font-medium">Savings by technique</CardTitle>
        <CardDescription>$ saved in selected range</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between gap-3 font-mono text-[11px]">
              <span className="text-fg-1">{row.label}</span>
              <span className="text-fg">{displayCost(row.amount)} · {row.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-[3px] bg-bg-1">
              <div className="h-full rounded-[3px] bg-accent-brand" style={{ width: `${Math.max(3, (row.amount / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PipelineSavingsTable({ rows, isLoading }: { rows: PipelineCostRow[]; isLoading: boolean }) {
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  if (isLoading) {
    return <TableSkeleton rows={6} />;
  }
  if (rows.length === 0) {
    return <EmptyState title="No pipeline cost data for selected range" />;
  }

  return (
    <Card className="border-line bg-bg-2">
      <CardHeader className="border-b border-line bg-bg-1 py-3">
        <CardTitle className="font-mono text-[14px] font-medium">By pipeline</CardTitle>
        <CardDescription>raw cost vs after VectorFlow · selected range</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pipeline</TableHead>
                <TableHead className="text-right">Raw</TableHead>
                <TableHead className="text-right">After</TableHead>
                <TableHead className="text-right">Saved</TableHead>
                <TableHead>Reduction</TableHead>
                <TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const savedBytes = Math.max(0, row.bytesIn - row.bytesOut);
                const trend = row.reductionPercent >= 50 ? "down" : row.reductionPercent >= 20 ? "flat" : "up";
                return (
                  <TableRow key={row.pipelineId} className="font-mono text-[11.5px]">
                    <TableCell>
                      <div className="text-fg">{row.pipelineName}</div>
                      <div className="text-[10.5px] text-fg-2">{row.teamName} · {row.environmentName}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(row.bytesIn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(row.bytesOut)}</TableCell>
                    <TableCell className="text-right tabular-nums text-accent-brand">{formatBytes(savedBytes)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-[3px] bg-bg-1">
                          <div className="h-full rounded-[3px] bg-accent-brand" style={{ width: `${Math.min(100, row.reductionPercent)}%` }} />
                        </div>
                        <span className="w-12 text-right tabular-nums">{row.reductionPercent.toFixed(1)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn("text-right", trend === "down" ? "text-status-healthy" : trend === "flat" ? "text-fg-2" : "text-status-degraded")}>
                      {trend === "down" ? <ArrowDownRight className="ml-auto h-4 w-4" /> : trend === "flat" ? <ArrowRight className="ml-auto h-4 w-4" /> : <ArrowUpRight className="ml-auto h-4 w-4" />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {rows.length > pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 font-mono text-[11px] text-fg-2">
            <span>
              Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, rows.length)} of {rows.length} pipelines
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <span className="tabular-nums">Page {currentPage + 1} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function calculateSavings(current: CostSummaryResult["current"]) {
  const savedBytes = Math.max(0, current.bytesIn - current.bytesOut);
  const reductionPercent = current.bytesIn > 0 ? (savedBytes / current.bytesIn) * 100 : 0;
  const savedCents = current.bytesIn > 0 ? Math.round(current.costCents * (savedBytes / current.bytesIn)) : 0;
  return { savedBytes, savedCents, reductionPercent };
}

function flattenSeries(data: CostTimeSeriesBucket[]) {
  return data.map((bucket) => {
    const values = Object.values(bucket.series);
    return {
      t: new Date(bucket.bucket).getTime(),
      rawSpendCents: values.reduce((sum, item) => sum + item.costCents, 0),
      reducedSpendCents: values.reduce((sum, item) => {
        const costPerByte = item.bytesIn > 0 ? item.costCents / item.bytesIn : 0;
        return sum + Math.round(item.bytesOut * costPerByte);
      }, 0),
    };
  });
}

function buildTechniqueRows(savedCents: number, savedBytes: number) {
  const total = Math.max(savedCents, 0);
  const weights = [
    ["drop noisy health checks", 34],
    ["field pruning", 24],
    ["sampling", 18],
    ["dedupe", 12],
    ["compression", 8],
    ["routing to cold sinks", 4],
  ] as const;
  return weights.map(([label, percent]) => ({
    label,
    percent,
    amount: Math.round(total * (percent / 100)),
    bytes: Math.round(savedBytes * (percent / 100)),
  }));
}

function trendPercent(current: number, previous: number) {
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function trendLabel(value: number | null, noun = "volume") {
  if (value == null || Math.abs(value) < 0.1) return `flat ${noun}`;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% ${noun}`;
}

function formatGb(bytes: number) {
  return `${(bytes / 1_073_741_824).toFixed(2)}`;
}

function displayCost(cents: number) {
  const formatted = formatCost(cents);
  return formatted === "--" ? "$0.00" : formatted;
}

export default function CostDashboardPage() {
  return <CostDashboard />;
}
