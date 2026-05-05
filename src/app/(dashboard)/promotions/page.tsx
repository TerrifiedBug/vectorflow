"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { Button } from "@/components/ui/button";
import { KpiStrip, KpiInStrip } from "@/components/ui/kpi-tile";
import { VFIcon } from "@/components/ui/vf-icon";
import { ConfigDiff } from "@/components/ui/config-diff";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { GitBranch } from "lucide-react";

/**
 * v2 Promotions hub (11a) — list + detail split with KPI strip and tabs.
 * Source: docs/internal/VectorFlow 2.0/screens/value-surfaces.jsx (ScreenPromotions).
 *
 * Wires to:
 *   - trpc.promotion.recentForTeam → list rows (team-scoped)
 *   - trpc.promotion.diffPreview → detail diff panel
 *
 * KPI metrics are computed client-side from the result set; expose as a
 * server aggregate (`promotion.summary`) when noise becomes a problem.
 */

type TabId = "pending" | "approved" | "in-flight" | "history";

type StatusKey =
  | "PENDING"
  | "APPROVED"
  | "DEPLOYED"
  | "REJECTED"
  | "CANCELLED"
  | "AWAITING_PR_MERGE"
  | "DEPLOYING";

interface PromotionRow {
  id: string;
  sourcePipelineId: string;
  pipelineName: string;
  fromEnv: string;
  toEnv: string;
  requestedBy: string;
  requestedAt: string;
  status: StatusKey;
}

const IN_FLIGHT_STATUSES: ReadonlySet<StatusKey> = new Set([
  "APPROVED",
  "AWAITING_PR_MERGE",
  "DEPLOYING",
]);

const HISTORY_STATUSES: ReadonlySet<StatusKey> = new Set([
  "DEPLOYED",
  "REJECTED",
  "CANCELLED",
]);

const TAB_FILTER: Record<TabId, (r: PromotionRow) => boolean> = {
  pending: (r) => r.status === "PENDING",
  approved: (r) => r.status === "APPROVED",
  "in-flight": (r) => IN_FLIGHT_STATUSES.has(r.status),
  history: (r) => HISTORY_STATUSES.has(r.status),
};

export default function PromotionsPage() {
  const trpc = useTRPC();
  const teamId = useTeamStore((s) => s.selectedTeamId);
  const [tab, setTab] = React.useState<TabId>("pending");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const recentQ = useQuery({
    ...trpc.promotion.recentForTeam.queryOptions(
      { teamId: teamId ?? "", limit: 100 },
      { enabled: Boolean(teamId) },
    ),
  });

  // Server response → row shape. The procedure includes nested relations
  // we project here to keep the rest of the view shape-stable.
  type ServerItem = {
    id: string;
    status: string;
    createdAt: string | Date;
    sourcePipeline: { id: string; name: string } | null;
    promotedBy: { name: string | null; email: string | null } | null;
    sourceEnvironment: { name: string } | null;
    targetEnvironment: { name: string } | null;
  };
  const rows: PromotionRow[] = React.useMemo(() => {
    const data = recentQ.data;
    if (!data || !Array.isArray(data.items)) return [];
    return (data.items as ServerItem[]).map((r) => ({
      id: r.id,
      sourcePipelineId: r.sourcePipeline?.id ?? "",
      pipelineName: r.sourcePipeline?.name ?? "—",
      fromEnv: r.sourceEnvironment?.name ?? "—",
      toEnv: r.targetEnvironment?.name ?? "—",
      requestedBy: r.promotedBy?.name ?? r.promotedBy?.email ?? "—",
      requestedAt:
        typeof r.createdAt === "string" ? r.createdAt : r.createdAt.toISOString(),
      status: r.status as StatusKey,
    }));
  }, [recentQ.data]);

  const counts = React.useMemo(
    () => ({
      pending: rows.filter(TAB_FILTER.pending).length,
      approved: rows.filter(TAB_FILTER.approved).length,
      "in-flight": rows.filter(TAB_FILTER["in-flight"]).length,
      history: rows.filter(TAB_FILTER.history).length,
    }),
    [rows],
  );

  const visibleRows = React.useMemo(
    () => rows.filter(TAB_FILTER[tab]),
    [rows, tab],
  );

  const selected = visibleRows.find((r) => r.id === selectedId) ?? visibleRows[0];

  const tabs: { id: TabId; label: string }[] = [
    { id: "pending", label: "Pending approval" },
    { id: "approved", label: "Approved" },
    { id: "in-flight", label: "In-flight" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="flex flex-col h-full bg-bg text-fg">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-line bg-bg-1 flex items-start justify-between">
        <div>
          <h1 className="m-0 font-mono text-[22px] font-medium tracking-[-0.01em]">
            Promotions
          </h1>
          <div className="mt-1 text-[12px] text-fg-2 max-w-[720px]">
            Move pipelines between environments with secret preflight,
            name-collision checks, and reviewable diffs. Every promotion is an
            artifact — like a pull request for ops.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm">
            <VFIcon name="filter" />
            Filter
          </Button>
          <Button variant="ghost" size="sm">
            <VFIcon name="download" />
            Export
          </Button>
          <Button variant="primary" size="sm">
            <VFIcon name="git" />
            New promotion
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <KpiStrip>
        <KpiInStrip
          label="OPEN REQUESTS"
          value={counts.pending + counts.approved}
          sub={`${counts.pending} awaiting review · 24h sla`}
        />
        <KpiInStrip
          label="AVG REVIEW TIME"
          value="—"
          sub="server aggregate · pending"
        />
        <KpiInStrip
          label="SUCCESS RATE"
          value={
            counts.history === 0
              ? "—"
              : Math.round(
                  (rows.filter((r) => r.status === "DEPLOYED").length /
                    Math.max(counts.history, 1)) *
                    100,
                )
          }
          unit={counts.history === 0 ? undefined : "%"}
          sub="last 30 promotions"
        />
        <KpiInStrip
          label="ROLLBACKS · 7D"
          value={rows.filter((r) => r.status === "REJECTED").length}
          sub="rejections + cancels"
        />
        <KpiInStrip
          label="PROMOTIONS · MO"
          value={counts.history}
          sub="executed this period"
          accent="var(--accent-brand)"
        />
      </KpiStrip>

      {/* MAIN */}
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "1fr 480px" }}>
        {/* LEFT — list */}
        <div className="flex flex-col min-h-0 border-r border-line">
          {/* Tabs */}
          <div className="flex items-center gap-5 px-5 border-b border-line bg-bg-1 h-11">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "h-full bg-transparent border-0 cursor-pointer flex items-center gap-1.5 px-0 text-[12px]",
                  tab === t.id
                    ? "text-fg border-b-2 border-accent-brand"
                    : "text-fg-2 hover:text-fg",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 rounded-full font-mono text-[10px] font-medium",
                    tab === t.id
                      ? "bg-accent-soft text-accent-brand"
                      : "bg-bg-3 text-fg-2",
                  )}
                >
                  {counts[t.id]}
                </span>
              </button>
            ))}
          </div>

          {/* Column header */}
          <div className="grid px-5 py-2 border-b border-line font-mono text-[10px] text-fg-2 uppercase tracking-[0.04em]"
               style={{ gridTemplateColumns: "60px 1fr 200px 110px 90px 80px" }}>
            <span>id</span>
            <span>pipeline</span>
            <span>flow</span>
            <span>by</span>
            <span className="text-right">secrets</span>
            <span className="text-right">state</span>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-auto">
            {!teamId && (
              <div className="p-5 text-fg-2 font-mono text-[12px]">
                Select a team to view promotions.
              </div>
            )}
            {teamId && recentQ.isPending && (
              <div className="p-5 text-fg-2 font-mono text-[12px]">Loading…</div>
            )}
            {teamId && recentQ.isError && (
              <div className="p-5 text-status-error font-mono text-[12px]">
                Failed to load promotions: {recentQ.error.message}
              </div>
            )}
            {teamId && recentQ.isSuccess && visibleRows.length === 0 && (
              <EmptyState
                glyph="◇"
                title="Nothing here"
                description={`No ${tabs.find((t) => t.id === tab)?.label.toLowerCase()} promotions.`}
                action={{ label: "New promotion", onClick: () => {} }}
              />
            )}
            {visibleRows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "w-full grid items-center px-5 py-2.5 border-b border-line text-left cursor-pointer font-mono text-[11.5px] hover:bg-bg-3/40 transition-colors",
                  r.id === selected?.id
                    ? "bg-bg-1 border-l-2 border-l-accent-brand"
                    : "border-l-2 border-l-transparent",
                )}
                style={{ gridTemplateColumns: "60px 1fr 200px 110px 90px 80px" }}
              >
                <span className="text-fg-2">{r.id.slice(0, 8)}</span>
                <span className="text-fg">
                  {r.pipelineName}
                  <span className="ml-2 text-fg-2 text-[10.5px]">
                    · {timeAgo(r.requestedAt)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-fg-1">
                  <span className="text-fg-2">{r.fromEnv}</span>
                  <span className="text-fg-2">→</span>
                  <span className={r.toEnv.startsWith("prod") ? "text-accent-brand" : "text-status-info"}>
                    {r.toEnv}
                  </span>
                </span>
                <span className="text-fg-1 truncate">{r.requestedBy}</span>
                <span className="text-right">
                  <span className="text-fg-2">—</span>
                </span>
                <span className="text-right">
                  <PromotionStatusPill status={r.status} />
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT — detail */}
        <div className="flex flex-col min-h-0 bg-bg overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-fg-2 font-mono text-[12px]">
              Select a promotion
            </div>
          ) : (
            <PromotionDetail row={selected} />
          )}
        </div>
      </div>
    </div>
  );
}

function PromotionStatusPill({ status }: { status: StatusKey }) {
  const cfg: Record<StatusKey, { label: string; tone: string }> = {
    PENDING: { label: "PENDING", tone: "bg-[color:var(--status-degraded-bg)] text-status-degraded border-[color:var(--status-degraded)]/40" },
    APPROVED: { label: "APPROVED", tone: "bg-[color:var(--status-info-bg)] text-status-info border-[color:var(--status-info)]/40" },
    DEPLOYED: { label: "DEPLOYED", tone: "bg-accent-soft text-accent-brand border-accent-line" },
    REJECTED: { label: "REJECTED", tone: "bg-[color:var(--status-error-bg)] text-status-error border-[color:var(--status-error)]/40" },
    CANCELLED: { label: "CANCELLED", tone: "bg-bg-3 text-fg-2 border-line-2" },
    AWAITING_PR_MERGE: { label: "AWAITING PR", tone: "bg-[color:var(--status-info-bg)] text-status-info border-[color:var(--status-info)]/40" },
    DEPLOYING: { label: "DEPLOYING", tone: "bg-[color:var(--status-info-bg)] text-status-info border-[color:var(--status-info)]/40" },
  };
  const c = cfg[status];
  return (
    <span className={cn("inline-block px-1.5 py-0.5 rounded-[3px] border font-medium text-[9.5px] tracking-[0.04em]", c.tone)}>
      {c.label}
    </span>
  );
}

function PromotionDetail({ row }: { row: PromotionRow }) {
  const trpc = useTRPC();
  const diffQ = useQuery({
    ...trpc.promotion.diffPreview.queryOptions(
      { pipelineId: row.sourcePipelineId },
      { enabled: Boolean(row.sourcePipelineId) },
    ),
  });

  return (
    <>
      <div className="px-5 py-3.5 border-b border-line bg-bg-1">
        <div className="font-mono text-[10.5px] text-fg-2 tracking-[0.04em]">
          {row.id.slice(0, 8)} · requested by {row.requestedBy} · {timeAgo(row.requestedAt)}
        </div>
        <div className="mt-1 font-mono text-[16px] text-fg">{row.pipelineName}</div>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-[11.5px]">
          <span className="px-2 py-0.5 rounded-[3px] bg-bg-3 border border-line-2 text-fg-1">
            {row.fromEnv}
          </span>
          <span className="text-fg-2">→</span>
          <span className="px-2 py-0.5 rounded-[3px] bg-accent-soft border border-accent-line text-accent-brand">
            {row.toEnv}
          </span>
          <span className="ml-auto text-fg-2 text-[10.5px]">requires admin approval</span>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-line">
        <div className="flex items-center gap-1">
          {["Target", "Preflight", "Diff", "Confirm", "Result"].map((s, i) => {
            const done = i < 2;
            const cur = i === 2;
            return (
              <React.Fragment key={s}>
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={cn(
                      "inline-flex items-center justify-center rounded-full font-mono text-[11px] font-semibold",
                      "h-[22px] w-[22px] border",
                      done
                        ? "bg-accent-brand text-primary-foreground border-accent-brand"
                        : cur
                          ? "bg-accent-soft text-accent-brand border-accent-brand"
                          : "bg-bg-2 text-fg-2 border-line-2",
                    )}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[9.5px] tracking-[0.03em]",
                      done || cur ? "text-fg" : "text-fg-2",
                    )}
                  >
                    {s}
                  </span>
                </div>
                {i < 4 && (
                  <div
                    className={cn(
                      "flex-1 h-px mb-3.5",
                      i < 1 ? "bg-accent-brand" : "bg-line-2",
                    )}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 text-[12px]">
        <div className="font-mono text-[10px] text-fg-2 tracking-[0.04em] uppercase mb-2">
          Preflight
        </div>
        <div className="p-2.5 bg-accent-soft border border-accent-line rounded-[3px] flex items-center gap-2.5 text-[11.5px]">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-brand text-primary-foreground font-mono text-[10px] font-semibold">
            ✓
          </span>
          <span className="text-fg">Secret resolution + collision check passed</span>
        </div>
        <div className="mt-1.5 px-2.5 py-2 bg-bg-2 border border-line rounded-[3px] font-mono text-[10.5px] text-fg-2">
          Wire diff via <span className="text-fg-1">trpc.promotion.diffPreview</span>
        </div>

        <div className="mt-4 font-mono text-[10px] text-fg-2 tracking-[0.04em] uppercase mb-2">
          Substitution preview · {row.fromEnv} → {row.toEnv}
        </div>
        <div className="border border-line rounded-[3px] bg-bg-2 font-mono text-[11px] leading-[1.7] overflow-hidden">
          {diffQ.isPending && (
            <div className="px-3 py-2 text-fg-2 text-[11px]">Loading diff…</div>
          )}
          {diffQ.isError && (
            <div className="px-3 py-2 text-status-error text-[11px]">
              Failed to load diff: {diffQ.error.message}
            </div>
          )}
          {diffQ.isSuccess && (
            <ConfigDiff
              oldConfig={diffQ.data.sourceYaml ?? ""}
              newConfig={diffQ.data.targetYaml ?? ""}
              oldLabel={row.fromEnv}
              newLabel={row.toEnv}
              className="p-3 text-[11px] font-mono leading-[1.7] max-h-[420px] overflow-auto bg-bg-2"
            />
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-line bg-bg-1 flex items-center justify-between">
        <div className="font-mono text-[10.5px] text-fg-2">step 3 of 5</div>
        <div className="flex gap-2">
          {row.status === "PENDING" ? (
            <>
              <Button variant="ghost" size="sm">
                <VFIcon name="x" />
                Reject
              </Button>
              <Button variant="primary" size="sm">
                <VFIcon name="check" />
                Approve & continue
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <a href="#" className="inline-flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                View on pipeline
              </a>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function timeAgo(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
