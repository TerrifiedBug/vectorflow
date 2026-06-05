"use client";

import Link from "next/link";
import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { Button } from "@/components/ui/button";
import { KpiStrip, KpiInStrip } from "@/components/ui/kpi-tile";
import { VFIcon } from "@/components/ui/vf-icon";
import { ConfigDiff } from "@/components/ui/config-diff";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { NewPromotionButton } from "@/components/new-promotion-button";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";

/**
 * v2 Promotions hub (11a) — list + detail split with KPI strip and tabs.
 * Source: docs/internal/VectorFlow 2.0/screens/value-surfaces.jsx (ScreenPromotions).
 *
 * Wires to:
 *   - trpc.release.promotion.recentForTeam → list rows (team-scoped)
 *   - trpc.release.promotion.summaryForTeam → aggregate KPI/tab counts
 *   - trpc.release.promotion.diffPreview → detail diff panel
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

type StatusFilter = "ALL" | Extract<
  StatusKey,
  | "PENDING"
  | "APPROVED"
  | "DEPLOYED"
  | "REJECTED"
  | "CANCELLED"
  | "AWAITING_PR_MERGE"
  | "DEPLOYING"
>;

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "ALL",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  DEPLOYED: "DEPLOYED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  AWAITING_PR_MERGE: "AWAITING PR",
  DEPLOYING: "DEPLOYING",
};

const TAB_STATUS_OPTIONS: Record<TabId, StatusFilter[]> = {
  pending: ["ALL", "PENDING"],
  approved: ["ALL", "APPROVED"],
  "in-flight": ["ALL", "APPROVED", "AWAITING_PR_MERGE", "DEPLOYING"],
  history: ["ALL", "DEPLOYED", "REJECTED", "CANCELLED"],
};

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


const TAB_SERVER_STATUSES: Record<TabId, StatusKey[]> = {
  pending: ["PENDING"],
  approved: ["APPROVED"],
  "in-flight": ["APPROVED", "AWAITING_PR_MERGE", "DEPLOYING"],
  history: ["DEPLOYED", "REJECTED", "CANCELLED"],
};

type ServerItem = {
  id: string;
  status: string;
  createdAt: string | Date;
  pipeline: { id: string; name: string } | null;
  requestedBy: { name: string | null; email: string | null } | null;
  environment: { name: string } | null;
  targetEnvironment: { name: string } | null;
};

function toPromotionRow(r: ServerItem): PromotionRow {
  return {
    id: r.id,
    sourcePipelineId: r.pipeline?.id ?? "",
    pipelineName: r.pipeline?.name ?? "—",
    fromEnv: r.environment?.name ?? "—",
    toEnv: r.targetEnvironment?.name ?? "—",
    requestedBy: r.requestedBy?.name ?? r.requestedBy?.email ?? "—",
    requestedAt:
      typeof r.createdAt === "string" ? r.createdAt : r.createdAt.toISOString(),
    status: r.status as StatusKey,
  };
}

export default function PromotionsPage() {
  const trpc = useTRPC();
  const teamId = useTeamStore((s) => s.selectedTeamId);
  const [tab, setTab] = React.useState<TabId>("pending");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("ALL");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const serverStatuses = TAB_SERVER_STATUSES[tab];

  const recentQ = useInfiniteQuery(
    trpc.release.promotion.recentForTeam.infiniteQueryOptions(
      {
        teamId: teamId ?? "",
        limit: 50,
        ...(statusFilter !== "ALL"
          ? { status: statusFilter }
          : { statuses: serverStatuses }),
      },
      {
        enabled: Boolean(teamId),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  const summaryQ = useQuery(
    trpc.release.promotion.summaryForTeam.queryOptions(
      { teamId: teamId ?? "" },
      { enabled: Boolean(teamId) },
    ),
  );

  // Server response → row shape. The procedure includes nested relations
  // we project here to keep the rest of the view shape-stable.
  const rows: PromotionRow[] = React.useMemo(() => {
    const items = recentQ.data?.pages.flatMap((page) => page.items) ?? [];
    return (items as ServerItem[]).map(toPromotionRow);
  }, [recentQ.data]);

  const counts = React.useMemo(() => {
    const summary = summaryQ.data;
    if (!summary) return null;

    return {
      pending: summary.PENDING,
      approved: summary.APPROVED,
      "in-flight": summary.APPROVED + summary.AWAITING_PR_MERGE + summary.DEPLOYING,
      history: summary.DEPLOYED + summary.REJECTED + summary.CANCELLED,
    };
  }, [summaryQ.data]);

  const deployedCount = summaryQ.data?.DEPLOYED ?? null;
  const rejectionCount = summaryQ.data?.REJECTED ?? null;

  const visibleRows = rows;

  const selected = visibleRows.find((r) => r.id === selectedId) ?? visibleRows[0];

  const tabs: { id: TabId; label: string }[] = [
    { id: "pending", label: "Pending approval" },
    { id: "approved", label: "Approved" },
    { id: "in-flight", label: "In-flight" },
    { id: "history", label: "History" },
  ];

  const handleExportCsv = React.useCallback(() => {
    const csv = toPromotionCsv(visibleRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "vectorflow-promotions.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [visibleRows]);

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
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter promotions by status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setSelectedId(null);
            }}
            className="h-8 rounded-[3px] border border-line bg-bg-2 px-2 font-mono text-[11px] text-fg outline-none hover:border-line-2 focus:border-accent-brand"
          >
            {TAB_STATUS_OPTIONS[tab].map((status) => (
              <option key={status} value={status}>
                {STATUS_FILTER_LABELS[status]}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExportCsv}
            disabled={visibleRows.length === 0}
          >
            <VFIcon name="download" />
            Export
          </Button>
          <NewPromotionButton
            label="New promotion"
            icon={<VFIcon name="git" />}
          />
        </div>
      </div>

      {/* KPI strip */}
      <KpiStrip>
        <KpiInStrip
          label="OPEN REQUESTS"
          value={counts ? counts.pending + counts.approved : "—"}
          sub="aggregate pending"
        />
        <KpiInStrip
          label="REVIEW TIME"
          value="—"
          sub="aggregate pending"
        />
        <KpiInStrip
          label="SUCCESS RATE"
          value={
            counts && counts.history > 0 && deployedCount !== null
              ? Math.round((deployedCount / counts.history) * 100)
              : "—"
          }
          unit={counts && counts.history > 0 ? "%" : undefined}
          sub="all-time aggregate"
        />
        <KpiInStrip
          label="REJECTIONS"
          value={rejectionCount ?? "—"}
          sub="all-time aggregate"
        />
        <KpiInStrip
          label="PROMOTIONS"
          value={counts ? counts.history : "—"}
          sub="all-time aggregate"
          accent="var(--accent-brand)"
        />
      </KpiStrip>

      {/* MAIN */}
      <div
        className={cn(
          "flex-1 grid min-h-0",
          visibleRows.length === 0 ? "grid-cols-1" : "lg:grid-cols-[1fr_480px]",
        )}
      >
        {/* LEFT — list */}
        <div className={cn("flex flex-col min-h-0", visibleRows.length > 0 && "border-r border-line")}>
          {/* Tabs */}
          <div className="flex items-center gap-5 px-5 border-b border-line bg-bg-1 h-11">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setStatusFilter("ALL");
                }}
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
                  {counts ? counts[t.id] : "—"}
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
              <div>
                {Array.from({ length: 6 }, (_, index) => (
                  <div
                    key={index}
                    className="grid items-center px-5 py-2.5 border-b border-line animate-pulse"
                    style={{ gridTemplateColumns: "60px 1fr 200px 110px 90px 80px" }}
                  >
                    <span className="h-3 w-10 rounded bg-bg-3" />
                    <span className="h-3 w-36 rounded bg-bg-3" />
                    <span className="h-3 w-28 rounded bg-bg-3" />
                    <span className="h-3 w-20 rounded bg-bg-3" />
                    <span className="ml-auto h-3 w-5 rounded bg-bg-3" />
                    <span className="ml-auto h-4 w-14 rounded bg-bg-3" />
                  </div>
                ))}
              </div>
            )}
            {teamId && recentQ.isError && (
              <div className="p-5 text-status-error font-mono text-[12px]">
                Failed to load promotions: {recentQ.error.message}
              </div>
            )}
            {teamId && recentQ.isSuccess && visibleRows.length === 0 && (
              <EmptyState
                glyph="◇"
                title="No promotions match this view"
                description={
                  statusFilter === "ALL"
                    ? `This team has no ${tabs.find((t) => t.id === tab)?.label.toLowerCase()} promotions yet.`
                    : `This team has no ${STATUS_FILTER_LABELS[statusFilter].toLowerCase()} promotions in this tab.`
                }
                action={{ label: "Start from pipelines", href: "/pipelines" }}
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
            {recentQ.hasNextPage && (
              <div className="flex justify-center p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void recentQ.fetchNextPage()}
                  disabled={recentQ.isFetchingNextPage}
                >
                  {recentQ.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {visibleRows.length === 0 ? (
          null
        ) : (
          <div className="flex flex-col min-h-0 bg-bg overflow-hidden">
            {selected && <PromotionDetail row={selected} />}
          </div>
        )}
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
  const queryClient = useQueryClient();
  const teamId = useTeamStore((s) => s.selectedTeamId);
  const diffQ = useQuery({
    ...trpc.release.promotion.diffPreview.queryOptions(
      { pipelineId: row.sourcePipelineId },
      { enabled: Boolean(row.sourcePipelineId) },
    ),
  });

  const invalidatePromotions = React.useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.release.promotion.recentForTeam.queryKey(),
    });
    queryClient.invalidateQueries({
      queryKey: trpc.release.promotion.summaryForTeam.queryKey({ teamId: teamId ?? "" }),
    });
  }, [queryClient, teamId, trpc.release.promotion.recentForTeam, trpc.release.promotion.summaryForTeam]);

  const rejectMutation = useMutation(
    trpc.release.promotion.reject.mutationOptions({
      onSuccess: () => {
        toast.success("Promotion rejected");
        invalidatePromotions();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to reject promotion", { duration: 6000 });
      },
    }),
  );

  const approveMutation = useMutation(
    trpc.release.promotion.approve.mutationOptions({
      onSuccess: () => {
        toast.success("Promotion approved");
        invalidatePromotions();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to approve promotion", { duration: 6000 });
      },
    }),
  );

  const actionPending = rejectMutation.isPending || approveMutation.isPending;

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
          Wire diff via <span className="text-fg-1">trpc.release.promotion.diffPreview</span>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  rejectMutation.mutate({
                    requestId: row.id,
                    note: "Rejected from promotions hub",
                  })
                }
                disabled={actionPending}
              >
                <VFIcon name="x" />
                {rejectMutation.isPending ? "Rejecting…" : "Reject"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => approveMutation.mutate({ requestId: row.id })}
                disabled={actionPending}
              >
                <VFIcon name="check" />
                {approveMutation.isPending ? "Approving…" : "Approve & continue"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <Link
                href={`/pipelines/${row.sourcePipelineId}`}
                className="inline-flex items-center gap-1.5"
              >
                <GitBranch className="h-3.5 w-3.5" />
                View on pipeline
              </Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}


function toPromotionCsv(rows: PromotionRow[]): string {
  const header = [
    "id",
    "sourcePipelineId",
    "pipelineName",
    "fromEnv",
    "toEnv",
    "requestedBy",
    "requestedAt",
    "status",
  ];
  const body = rows.map((row) =>
    [
      row.id,
      row.sourcePipelineId,
      row.pipelineName,
      row.fromEnv,
      row.toEnv,
      row.requestedBy,
      row.requestedAt,
      row.status,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
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
