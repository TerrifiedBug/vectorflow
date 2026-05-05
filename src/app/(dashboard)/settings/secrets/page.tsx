"use client";

import * as React from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { Button } from "@/components/ui/button";
import { KpiStrip, KpiInStrip } from "@/components/ui/kpi-tile";
import { VFIcon } from "@/components/ui/vf-icon";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

/**
 * v2 Secrets vault (11d) — settings sub-page.
 * Source: docs/internal/VectorFlow 2.0/screens/handoff-surfaces.jsx (ScreenSecretsVault).
 *
 * Wires to:
 *   - trpc.environment.list (env list for left segmentation)
 *   - trpc.secret.list (per environment) — current router lists by env
 *
 * Cross-env aggregation aggregates client-side until a tenant-wide
 * `secret.listAll` is exposed.
 */

interface SecretOccurrence {
  id: string;
  environmentId: string;
  environmentName: string;
}

interface SecretRow {
  id: string;
  name: string;
  envs: string[];
  occurrences: SecretOccurrence[];
  createdAt: string;
  updatedAt: string;
  uses: number;
  status: "ok" | "fresh" | "aging" | "unused";
  rotated: string;
}

export default function SecretsVaultPage() {
  const trpc = useTRPC();
  const teamId = useTeamStore((s) => s.selectedTeamId);
  // selectedEnvironmentId reserved for env-scoped detail actions (rotate, etc.).
  void useEnvironmentStore((s) => s.selectedEnvironmentId);

  const envsQ = useQuery({
    ...trpc.environment.list.queryOptions({ teamId: teamId ?? "" }),
    enabled: !!teamId,
  });
  const envs: { id: string; name: string }[] = (envsQ.data ?? []) as { id: string; name: string }[];

  // Pull secrets for each environment in a stable batch — useQueries respects
  // hook order across render even when env count changes.
  const perEnvQueries = useQueries({
    queries: envs.map((e) => ({
      ...trpc.secret.list.queryOptions({ environmentId: e.id }),
      enabled: !!e.id,
    })),
  });
  const allLoading = perEnvQueries.some((q) => q.isPending);

  type RawSecret = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };

  const rows: SecretRow[] = React.useMemo(() => {
    const map = new Map<string, SecretRow>();
    perEnvQueries.forEach((q, i) => {
      const env = envs[i];
      const envName = env?.name ?? "—";
      const list = (q.data ?? []) as RawSecret[];
      for (const s of list) {
        const key = s.name;
        const existing = map.get(key);
        const occurrence: SecretOccurrence = {
          id: s.id,
          environmentId: env?.id ?? "",
          environmentName: envName,
        };
        if (existing) {
          if (!existing.envs.includes(envName)) existing.envs.push(envName);
          existing.occurrences.push(occurrence);
        } else {
          map.set(key, secretToRow(s, [envName], [occurrence]));
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [perEnvQueries, envs]);

  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const selected = rows.find((r) => r.name === selectedName) ?? rows[0];

  // Usage: query per occurrence (one Secret row per env). Refs from each are
  // merged for the detail panel. Per-env caching keeps the request graph stable.
  const usageQueries = useQueries({
    queries: (selected?.occurrences ?? []).map((occ) => ({
      ...trpc.secret.usage.queryOptions({
        secretId: occ.id,
        environmentId: occ.environmentId,
      }),
      enabled: !!selected,
    })),
  });

  type UsageRef = {
    id: string;
    componentType: string;
    pipeline: { id: string; name: string; environment: { id: string; name: string } };
  };
  const usageRefs: UsageRef[] = React.useMemo(() => {
    const all: UsageRef[] = [];
    for (const q of usageQueries) {
      const data = q.data as { count: number; refs: UsageRef[] } | undefined;
      if (data?.refs) all.push(...data.refs);
    }
    return all;
  }, [usageQueries]);
  const usageCount = usageRefs.length;
  const usageLoading = usageQueries.some((q) => q.isPending);

  const counts = React.useMemo(
    () => ({
      total: rows.length,
      rotated30d: rows.filter((r) => isWithin(r.updatedAt, 30)).length,
      aging: rows.filter((r) => r.status === "aging").length,
      unused: rows.filter((r) => r.status === "unused").length,
    }),
    [rows],
  );

  return (
    <div className="flex flex-col h-full bg-bg text-fg">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-line bg-bg-1 flex items-start justify-between">
        <div>
          <div className="font-mono text-[11px] text-fg-2 tracking-[0.04em]">
            settings / secrets
          </div>
          <h1 className="m-0 mt-1 font-mono text-[22px] font-medium tracking-[-0.01em]">
            Secrets vault
          </h1>
          <div className="mt-1 text-[12px] text-fg-2 max-w-[720px]">
            Encrypted at rest with envelope encryption. Referenced from pipelines as{" "}
            <span className="font-mono text-fg-1">SECRET[name]</span>; values never appear in
            canvas, diff, audit log, or wire.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm">
            <VFIcon name="upload" />
            Import
          </Button>
          <Button variant="ghost" size="sm">
            <VFIcon name="rotate-cw" />
            Rotate selected
          </Button>
          <Button variant="primary" size="sm">
            <VFIcon name="plus" />
            New secret
          </Button>
        </div>
      </div>

      <KpiStrip>
        <KpiInStrip label="TOTAL SECRETS" value={counts.total} sub={`across ${envs.length} environments`} />
        <KpiInStrip label="ROTATED · 30D" value={counts.rotated30d} sub="auto + manual" accent="var(--accent-brand)" />
        <KpiInStrip label="AGING · 90D+" value={counts.aging} sub="needs rotation" accent={counts.aging > 0 ? "var(--status-degraded)" : undefined} />
        <KpiInStrip label="UNUSED" value={counts.unused} sub="safe to delete" />
        <KpiInStrip
          label="USED BY"
          value={selected ? (usageLoading ? "…" : usageCount) : "—"}
          sub={selected ? `${selected.name} · ${usageCount === 1 ? "pipeline" : "pipelines"}` : "select a secret"}
        />
      </KpiStrip>

      {!teamId && <EmptyState glyph="◇" title="Select a team" description="Secrets are scoped per environment within a team." />}

      {teamId && rows.length === 0 && !allLoading && (
        <EmptyState
          glyph="🔑"
          title="No secrets yet"
          description="Create a secret and reference it from your pipelines as SECRET[name]."
          action={{ label: "New secret", onClick: () => {} }}
        />
      )}

      {teamId && rows.length > 0 && (
        <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "1fr 440px" }}>
          {/* LEFT — list */}
          <div className="flex flex-col min-h-0 border-r border-line">
            <div
              className="grid px-5 py-2 border-b border-line font-mono text-[10px] text-fg-2 uppercase tracking-[0.04em]"
              style={{ gridTemplateColumns: "1.6fr 100px 110px 1fr 70px 100px" }}
            >
              <span>name</span>
              <span>kind</span>
              <span>last rotated</span>
              <span>envs</span>
              <span className="text-right">uses</span>
              <span className="text-right">status</span>
            </div>
            <div className="flex-1 overflow-auto">
              {rows.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedName(s.name)}
                  className={cn(
                    "grid w-full text-left items-center px-5 py-2.5 border-b border-line font-mono text-[11.5px] cursor-pointer transition-colors",
                    s.name === (selected?.name ?? "")
                      ? "bg-bg-1 border-l-2 border-l-accent-brand"
                      : "border-l-2 border-l-transparent hover:bg-bg-3/40",
                  )}
                  style={{ gridTemplateColumns: "1.6fr 100px 110px 1fr 70px 100px" }}
                >
                  <span className="text-fg flex items-center gap-1.5 truncate">
                    <span className="text-fg-2">🔑</span>
                    {s.name}
                  </span>
                  <span className="text-fg-2">—</span>
                  <span className={s.rotated === "never" ? "text-fg-2" : "text-fg-1"}>{s.rotated}</span>
                  <span className="flex gap-1 flex-wrap">
                    {s.envs.length === 0 && <span className="text-fg-2 text-[10.5px]">—</span>}
                    {s.envs.map((e) => (
                      <Pill key={e} variant={e.startsWith("prod") ? "envProd" : "env"} size="xs">
                        {e}
                      </Pill>
                    ))}
                  </span>
                  <span className={cn("text-right", s.uses === 0 ? "text-fg-2" : "text-fg")}>
                    {s.uses}
                  </span>
                  <span className="text-right">
                    <SecretStatusBadge status={s.status} />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* RIGHT — detail */}
          <div className="flex flex-col min-h-0 overflow-hidden">
            {selected ? (
              <SecretDetail
                row={selected}
                usageRefs={usageRefs}
                usageLoading={usageLoading}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function SecretStatusBadge({ status }: { status: SecretRow["status"] }) {
  if (status === "ok") return <span className="text-accent-brand text-[10px] tracking-[0.04em]">OK</span>;
  if (status === "fresh") return <span className="text-status-info text-[10px] tracking-[0.04em]">FRESH</span>;
  if (status === "unused") return <span className="text-fg-2 text-[10px] tracking-[0.04em]">UNUSED</span>;
  return (
    <span className="px-1.5 py-0.5 rounded-[3px] bg-[color:var(--status-degraded-bg)] border border-[color:var(--status-degraded)]/40 text-status-degraded text-[9.5px] tracking-[0.04em]">
      AGING
    </span>
  );
}

interface UsageRef {
  id: string;
  componentType: string;
  pipeline: { id: string; name: string; environment: { id: string; name: string } };
}

function SecretDetail({
  row,
  usageRefs,
  usageLoading,
}: {
  row: SecretRow;
  usageRefs: UsageRef[];
  usageLoading: boolean;
}) {
  const usageCount = usageRefs.length;
  return (
    <>
      <div className="px-5 py-3.5 border-b border-line bg-bg-1">
        <div className="font-mono text-[10.5px] text-fg-2 tracking-[0.04em]">
          created {timeAgo(row.createdAt)} ago
        </div>
        <div className="mt-1 font-mono text-[16px] text-fg">{row.name}</div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {/* Value (masked) */}
        <div className="mb-4">
          <div className="font-mono text-[10px] text-fg-2 tracking-[0.04em] uppercase mb-1.5">
            Value
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-bg-2 border border-line rounded-[3px] font-mono text-[12px] text-fg-1">
            <span className="flex-1 tracking-[2px]">••••••••••••••••••••••••••</span>
            <Button variant="ghost" size="xs">
              Reveal
            </Button>
            <Button variant="ghost" size="xs">
              <VFIcon name="copy" />
              Copy
            </Button>
          </div>
          <div className="mt-1.5 font-mono text-[10.5px] text-fg-2">
            Reveal logged to audit · expires session in 60s
          </div>
        </div>

        {/* Rotation */}
        <div className="mb-4">
          <div className="font-mono text-[10px] text-fg-2 tracking-[0.04em] uppercase mb-1.5">
            Rotation
          </div>
          <div className="p-3 bg-bg-2 border border-line rounded-[3px] font-mono text-[11.5px] leading-[1.7]">
            <div className="flex justify-between">
              <span className="text-fg-2">last rotated</span>
              <span className="text-fg">{row.rotated}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-2">cadence</span>
              <span className="text-fg">manual</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-2">next scheduled</span>
              <span className="text-fg-2">—</span>
            </div>
          </div>
          <div className="mt-2 flex gap-1.5">
            <Button variant="default" size="xs">
              <VFIcon name="rotate-cw" />
              Rotate now
            </Button>
            <Button variant="ghost" size="xs">
              Edit cadence
            </Button>
          </div>
        </div>

        {/* Used by */}
        <div>
          <div className="font-mono text-[10px] text-fg-2 tracking-[0.04em] uppercase mb-1.5">
            Used by · {usageLoading ? "…" : `${usageCount} pipeline${usageCount === 1 ? "" : "s"}`}
          </div>
          <div className="bg-bg-2 border border-line rounded-[3px] overflow-hidden">
            {usageLoading ? (
              <div className="px-3 py-3 font-mono text-[11px] text-fg-2 text-center">
                Loading references…
              </div>
            ) : usageCount === 0 ? (
              <div className="px-3 py-3 font-mono text-[11px] text-fg-2 text-center">
                Not referenced by any pipeline yet.
              </div>
            ) : (
              <div className="divide-y divide-line">
                {usageRefs.map((ref) => (
                  <div
                    key={ref.id}
                    className="grid items-center px-3 py-2 font-mono text-[11.5px]"
                    style={{ gridTemplateColumns: "1fr 80px 1fr" }}
                  >
                    <span className="text-fg truncate" title={ref.pipeline.name}>
                      {ref.pipeline.name}
                    </span>
                    <span>
                      <Pill
                        variant={ref.pipeline.environment.name.startsWith("prod") ? "envProd" : "env"}
                        size="xs"
                      >
                        {ref.pipeline.environment.name}
                      </Pill>
                    </span>
                    <span className="text-fg-1 truncate text-right" title={ref.componentType}>
                      {ref.componentType}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-line bg-bg-1 flex gap-2 items-center">
        <Button variant="ghost" size="sm" className="text-status-error">
          <VFIcon name="trash" />
          Delete
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto">
          <VFIcon name="external-link" />
          View audit
        </Button>
        <Button variant="default" size="sm">
          <VFIcon name="edit" />
          Edit
        </Button>
      </div>
    </>
  );
}

function isWithin(iso: string, days: number): boolean {
  const ms = Date.now() - new Date(iso).getTime();
  return ms < days * 24 * 60 * 60 * 1000;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (d > 0) return `${d}d`;
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h > 0) return `${h}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function secretToRow(
  s: { id: string; name: string; createdAt: string; updatedAt: string },
  envs: string[],
  occurrences: SecretOccurrence[],
): SecretRow {
  const ageDays = (Date.now() - new Date(s.updatedAt).getTime()) / (24 * 60 * 60 * 1000);
  const status: SecretRow["status"] =
    envs.length === 0 ? "unused" : ageDays > 90 ? "aging" : ageDays < 7 ? "fresh" : "ok";
  return {
    id: s.id,
    name: s.name,
    envs,
    occurrences,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    uses: 0,
    status,
    rotated: ageDays < 1 ? "today" : `${Math.floor(ageDays)}d ago`,
  };
}
