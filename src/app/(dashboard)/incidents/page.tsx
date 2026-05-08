"use client";

import * as React from "react";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { KpiStrip, KpiInStrip } from "@/components/ui/kpi-tile";
import { EventDot, type EventKind } from "@/components/ui/event-dot";
import { VFIcon } from "@/components/ui/vf-icon";
import { EmptyState } from "@/components/empty-state";

const HOURS = 14;
const COL_W = 100 / HOURS;

type TimelineSignal = {
  id?: string;
  kind: EventKind | "alert" | "anomaly";
  timestamp?: string | Date;
  firedAt?: string | Date;
  detectedAt?: string | Date;
  createdAt?: string | Date;
  status?: string | null;
  action?: string | null;
  title?: string | null;
  description?: string | null;
  anomalyType?: string | null;
  pipelineId?: string | null;
  pipelineName?: string | null;
  alertRule?: {
    name?: string | null;
    metric?: string | null;
    pipeline?: { id?: string | null; name?: string | null } | null;
  } | null;
  pipeline?: { id?: string | null; name?: string | null } | null;
};

type CorrelationGroup = {
  id: string;
  status: "firing" | "resolved" | "acknowledged";
  title?: string | null;
  openedAt: string | Date;
  resolvedAt?: string | Date | null;
  alertCount: number;
  anomalyCount: number;
  signalCount: number;
  timeline: TimelineSignal[];
};

type DeploymentEvent = {
  id: string;
  action: string;
  createdAt: string | Date;
  pipelineId?: string | null;
  pipelineName?: string | null;
  entityId?: string | null;
  versionInfo?: string | null;
};

type TimelineEvent = {
  id: string;
  kind: EventKind;
  hour: number;
  label: string;
  ts: string;
};

type TimelineRow = {
  id: string;
  groupId?: string;
  title: string;
  env: string;
  state: "firing" | "acknowledged" | "resolved";
  alertCount: number;
  anomalyCount: number;
  deployCount: number;
  rollbackCount: number;
  events: TimelineEvent[];
};

function toIso(value: string | Date | undefined | null): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

function eventTime(signal: TimelineSignal): string {
  return toIso(signal.timestamp ?? signal.firedAt ?? signal.detectedAt ?? signal.createdAt);
}

function signalLabel(signal: TimelineSignal): string {
  if (signal.kind === "alert") {
    return signal.alertRule?.name ?? signal.alertRule?.metric ?? signal.description ?? "alert";
  }
  if (signal.kind === "anomaly") {
    return signal.description ?? signal.anomalyType ?? "anomaly";
  }
  return signal.title ?? signal.description ?? signal.action ?? signal.kind;
}

function deploymentKind(action: string): EventKind {
  return action.toLowerCase().includes("rollback") ? "rollback" : "deploy";
}

function deploymentLabel(event: DeploymentEvent): string {
  const action = event.action.toLowerCase().replaceAll("_", " ");
  const version = event.versionInfo ? ` · ${event.versionInfo}` : "";
  return `${action}${version}`;
}

function bucketFor(timestamp: string, from: Date, to: Date): number | null {
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t) || t < from.getTime() || t > to.getTime()) return null;
  const windowMs = Math.max(60 * 60 * 1000, to.getTime() - from.getTime());
  const bucketMs = windowMs / HOURS;
  return Math.max(0, Math.min(HOURS - 1, Math.floor((t - from.getTime()) / bucketMs)));
}

function isTimelineEvent(event: TimelineEvent | null): event is TimelineEvent {
  return event !== null;
}

export default function IncidentsPage() {
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(() => ({
    from: new Date(Date.now() - HOURS * 60 * 60 * 1000),
    to: new Date(),
  }));
  const [selectedRowId, setSelectedRowId] = React.useState<string | null>(null);

  const queryWindow = React.useMemo(() => {
    const to = dateRange?.to ?? new Date();
    const from = dateRange?.from ?? new Date(to.getTime() - HOURS * 60 * 60 * 1000);
    return { from, to };
  }, [dateRange]);

  const groupsQ = useInfiniteQuery(
    trpc.alert.listCorrelationGroups.infiniteQueryOptions(
      {
        environmentId: selectedEnvironmentId ?? "",
        limit: 100,
      },
      {
        enabled: !!selectedEnvironmentId,
        refetchInterval: 5_000,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  const deploymentsQ = useInfiniteQuery(
    trpc.audit.deployments.infiniteQueryOptions(
      {
        startDate: queryWindow.from.toISOString(),
        endDate: queryWindow.to.toISOString(),
      },
      {
        enabled: !!selectedEnvironmentId,
        refetchInterval: 10_000,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  const pipelineCardsQ = useQuery({
    ...trpc.dashboard.pipelineCards.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: 10_000,
  });

  const groupPreviews = React.useMemo(
    () => groupsQ.data?.pages.flatMap((page) => page.items as unknown as CorrelationGroup[]) ?? [],
    [groupsQ.data],
  );
  const groupDetailsQueries = useQueries({
    queries: groupPreviews.map((group: CorrelationGroup) => ({
      ...trpc.alert.getCorrelationGroup.queryOptions({ id: group.id }),
      enabled: !!selectedEnvironmentId,
    })),
  });
  const groups = React.useMemo(
    () =>
      groupPreviews.map((group: CorrelationGroup, index: number) =>
        ((groupDetailsQueries[index]?.data as CorrelationGroup | undefined) ?? group),
      ),
    [groupDetailsQueries, groupPreviews],
  );
  const deployments = React.useMemo(
    () => deploymentsQ.data?.pages.flatMap((page) => page.items as unknown as DeploymentEvent[]) ?? [],
    [deploymentsQ.data],
  );
  const environmentPipelineIds = React.useMemo(() => {
    const cards = Array.isArray(pipelineCardsQ.data) ? pipelineCardsQ.data : [];
    return new Set(cards.map((card) => card.id));
  }, [pipelineCardsQ.data]);

  React.useEffect(() => {
    if (groupsQ.hasNextPage && !groupsQ.isFetchingNextPage) {
      void groupsQ.fetchNextPage();
    }
  }, [groupsQ]);

  React.useEffect(() => {
    if (deploymentsQ.hasNextPage && !deploymentsQ.isFetchingNextPage) {
      void deploymentsQ.fetchNextPage();
    }
  }, [deploymentsQ]);

  const rows: TimelineRow[] = React.useMemo(() => {
    const byPipeline = new Map<string, TimelineRow>();

    for (const group of groups) {
      const filteredSignals = group.timeline
        .map<TimelineEvent | null>((signal: TimelineSignal) => {
          const ts = eventTime(signal);
          const bucket = bucketFor(ts, queryWindow.from, queryWindow.to);
          if (bucket == null) return null;
          const kind: EventKind = signal.kind === "alert" ? "alert" : signal.kind === "anomaly" ? "anomaly" : "note";
          return {
            id: signal.id ?? `${group.id}-${ts}`,
            kind,
            hour: bucket,
            label: signalLabel(signal),
            ts,
          };
        })
        .filter(isTimelineEvent);
      if (filteredSignals.length === 0) continue;

      const firstSignal = group.timeline[0];
      const title = group.title ?? firstSignal?.alertRule?.pipeline?.name ?? firstSignal?.pipeline?.name ?? firstSignal?.pipelineName ?? "correlated incident";
      byPipeline.set(group.id, {
        id: group.id,
        groupId: group.id,
        title,
        env: selectedEnvironmentId ?? "—",
        state: group.status,
        alertCount: filteredSignals.filter((event) => event.kind === "alert").length,
        anomalyCount: filteredSignals.filter((event) => event.kind === "anomaly").length,
        deployCount: 0,
        rollbackCount: 0,
        events: filteredSignals,
      });
    }

    for (const event of deployments) {
      if (!event.action) continue;
      const pipelineKey = event.pipelineId ?? event.entityId ?? null;
      if (environmentPipelineIds.size === 0) continue;
      if (!pipelineKey || !environmentPipelineIds.has(pipelineKey)) continue;
      const ts = toIso(event.createdAt);
      const bucket = bucketFor(ts, queryWindow.from, queryWindow.to);
      if (bucket == null) continue;
      const key = `deployment:${pipelineKey}`;
      const row: TimelineRow = byPipeline.get(key) ?? {
        id: key,
        title: event.pipelineName ?? "deployment activity",
        env: selectedEnvironmentId ?? "—",
        state: "resolved" as const,
        alertCount: 0,
        anomalyCount: 0,
        deployCount: 0,
        rollbackCount: 0,
        events: [],
      };
      const kind = deploymentKind(event.action);
      if (kind === "rollback") row.rollbackCount += 1;
      else row.deployCount += 1;
      row.events.push({
        id: event.id,
        kind,
        hour: bucket,
        label: deploymentLabel(event),
        ts,
      });
      byPipeline.set(key, row);
    }

    return Array.from(byPipeline.values())
      .map((row) => ({ ...row, events: row.events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()) }))
      .sort((a, b) => Number(b.state === "firing") - Number(a.state === "firing") || b.events.length - a.events.length)
      .slice(0, 50);
  }, [deployments, environmentPipelineIds, groups, queryWindow, selectedEnvironmentId]);

  const selectedRow = rows.find((row) => row.id === selectedRowId) ?? rows[0];
  const counts = React.useMemo(() => {
    const active = rows.filter((row) => row.state === "firing").length;
    const alerts = rows.reduce((sum, row) => sum + row.alertCount, 0);
    const anomalies = rows.reduce((sum, row) => sum + row.anomalyCount, 0);
    const deploys = rows.reduce((sum, row) => sum + row.deployCount, 0);
    const rollbacks = rows.reduce((sum, row) => sum + row.rollbackCount, 0);
    return { active, alerts, anomalies, deploys, rollbacks, signals: alerts + anomalies + deploys + rollbacks };
  }, [rows]);

  const hourLabels = React.useMemo(
    () => Array.from({ length: HOURS }, (_, i) => {
      const ago = HOURS - 1 - i;
      if (ago === 0) return "now";
      if (ago % 2 !== 0) return "";
      return `−${ago}h`;
    }),
    [],
  );

  const isPending =
    groupsQ.isPending || deploymentsQ.isPending || pipelineCardsQ.isPending || groupDetailsQueries.some((query) => query.isPending);
  const isError =
    groupsQ.isError || deploymentsQ.isError || pipelineCardsQ.isError || groupDetailsQueries.some((query) => query.isError);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <div className="flex items-start justify-between border-b border-line bg-bg px-6 py-5">
        <div>
          <h1 className="m-0 font-mono text-[22px] font-medium tracking-[-0.01em]">Incident timeline</h1>
          <div className="mt-1 max-w-[760px] text-[12px] text-fg-1">
            Correlated alert, anomaly, deploy, and rollback signals for the selected environment and time window.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <VFIcon name="filter" />
            All signals
          </Button>
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder="Incident window"
            className="h-7 w-[240px] border-line-2 bg-bg-2 font-mono text-[11px]"
            align="end"
          />
          <Button variant="ghost" size="sm" onClick={() => setDateRange({ from: new Date(Date.now() - HOURS * 60 * 60 * 1000), to: new Date() })}>
            14h
          </Button>
          <Button variant="default" size="sm">
            <VFIcon name="zap" />
            Acknowledge all
          </Button>
        </div>
      </div>

      <KpiStrip>
        <KpiInStrip label="ACTIVE INCIDENTS" value={counts.active} sub={`${counts.active} firing ${counts.active === 1 ? "incident" : "incidents"}`} accent={counts.active > 0 ? "var(--status-error)" : undefined} />
        <KpiInStrip label="SIGNALS · 14H" value={counts.signals} sub={`${counts.alerts} alerts · ${counts.anomalies} anomalies`} />
        <KpiInStrip label="DEPLOYS · 14H" value={counts.deploys} sub={`${counts.rollbacks} rollbacks`} />
        <KpiInStrip label="MTTR" value="—" unit="min" sub="median resolve" />
      </KpiStrip>

      {!selectedEnvironmentId && (
        <EmptyState glyph="◇" title="Select an environment" description="The incident timeline is scoped per environment." />
      )}

      {selectedEnvironmentId && isError && (
        <EmptyState glyph="!" title="Incident timeline unavailable" description="Failed to load correlated incident data." />
      )}

      {selectedEnvironmentId && isPending && (
        <div className="flex-1 p-5" aria-label="Loading incident timeline">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2">Loading incident timeline</div>
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="grid gap-3" style={{ gridTemplateColumns: "180px 1fr" }}>
                <div className="h-10 animate-pulse rounded-[3px] border border-line bg-bg-2" />
                <div className="h-10 animate-pulse rounded-[3px] border border-line bg-bg-2" />
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedEnvironmentId && !isPending && rows.length === 0 && groupsQ.isSuccess && (
        <EmptyState glyph="✓" title="No incidents detected" description="No correlated alert, anomaly, deployment, or rollback signals in the selected window." />
      )}

      {selectedEnvironmentId && !isPending && rows.length > 0 && (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "1fr 380px" }}>
          <div className="flex min-h-0 flex-col overflow-hidden border-r border-line">
            <div className="grid border-b border-line bg-bg-1" style={{ gridTemplateColumns: "180px 1fr" }}>
              <div className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">pipeline</div>
              <div className="relative h-8 px-3">
                {hourLabels.map((label, i) => (
                  <div key={i} className="absolute top-0 bottom-0 flex -translate-x-1/2 items-center justify-center font-mono text-[10px] text-fg-2" style={{ left: `calc(${i * COL_W}% + ${COL_W / 2}%)` }}>
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {rows.map((row) => {
                const stateColor = row.state === "firing" ? "var(--status-error)" : row.state === "acknowledged" ? "var(--status-degraded)" : "var(--fg-2)";
                const isSelected = row.id === selectedRow?.id;
                return (
                  <button key={row.id} type="button" onClick={() => setSelectedRowId(row.id)} className={`grid min-h-[56px] w-full cursor-pointer border-b border-line text-left transition-colors ${isSelected ? "border-l-2 border-l-accent-brand bg-bg-1" : "border-l-2 border-l-transparent hover:bg-bg-3/30"}`} style={{ gridTemplateColumns: "180px 1fr" }}>
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: stateColor }} />
                        <span className="font-mono text-[12px] font-medium text-fg">{row.title}</span>
                      </div>
                      <div className="mt-1 ml-3 font-mono text-[10.5px] text-fg-2">{row.env} · {row.state}</div>
                    </div>
                    <div className="relative min-h-[56px] px-3">
                      {hourLabels.map((_, i) => (
                        <div key={i} className="absolute top-0 bottom-0 w-px bg-line opacity-30" style={{ left: `calc(${i * COL_W}% + ${COL_W / 2}%)` }} />
                      ))}
                      <div className="absolute right-3 left-3 top-1/2 h-px bg-line opacity-50" />
                      {row.events.map((event) => (
                        <div key={event.id} title={event.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `calc(${event.hour * COL_W}% + ${COL_W / 2}%)`, top: "50%" }}>
                          <EventDot kind={event.kind} size={10} />
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-4 border-t border-line bg-bg-1 px-5 py-2.5 font-mono text-[11px] text-fg-2">
              <span className="flex items-center gap-1.5"><EventDot kind="alert" size={8} /> alert</span>
              <span className="flex items-center gap-1.5"><EventDot kind="anomaly" size={8} /> anomaly</span>
              <span className="flex items-center gap-1.5"><EventDot kind="deploy" size={8} /> deploy</span>
              <span className="flex items-center gap-1.5"><EventDot kind="rollback" size={8} /> rollback</span>
              <span className="ml-auto">correlated timeline</span>
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden bg-bg">
            {selectedRow ? <IncidentDetail row={selectedRow} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentDetail({ row }: { row: TimelineRow }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-fg-2">selected incident</div>
        <div className="mt-1 font-mono text-[16px] font-medium text-fg">{row.title}</div>
        <div className="mt-2 font-mono text-[11px] text-fg-2">{row.alertCount} alerts · {row.anomalyCount} anomalies · {row.deployCount} deploys · {row.rollbackCount} rollbacks</div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {row.events.map((event) => (
            <div key={event.id} className="grid grid-cols-[auto_1fr] gap-3 rounded-[3px] border border-line bg-bg-2 p-3">
              <EventDot kind={event.kind} size={10} />
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2">{fmtTime(event.ts)} · {event.kind}</div>
                <div className="mt-1 text-[12px] text-fg">{event.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
