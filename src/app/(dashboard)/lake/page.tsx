"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Database, Search, Play, ListTree, Users, Rewind } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useTeamStore } from "@/stores/team-store";
import { formatBytes } from "@/lib/format";
import { FilterPresetBar } from "@/components/filter-preset/FilterPresetBar";
import { SaveFilterDialog } from "@/components/filter-preset/SaveFilterDialog";
import { LakeResultsTable } from "./_components/lake-results-table";
import { ReplayDialog } from "./_components/replay-dialog";

const ALL_VALUE = "__all__";
const EPOCH = new Date(0);

const RANGE_PRESETS: Record<string, { label: string; ms: number }> = {
  "15m": { label: "Last 15 minutes", ms: 15 * 60 * 1000 },
  "1h": { label: "Last hour", ms: 60 * 60 * 1000 },
  "6h": { label: "Last 6 hours", ms: 6 * 60 * 60 * 1000 },
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
};

type EventType = "log" | "metric" | "trace";

interface AppliedSearch {
  mode: "guided" | "raw";
  pipelineId: string;
  from: Date;
  to: Date;
  eventType?: EventType;
  query?: string;
  where?: string;
}

export default function LakePage() {
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const statusQuery = useQuery(trpc.lake.status.queryOptions());
  const lakeEnabled = statusQuery.data?.enabled ?? false;

  const teamRoleQuery = useQuery({
    ...trpc.team.teamRole.queryOptions({ teamId: selectedTeamId ?? "" }),
    enabled: !!selectedTeamId,
  });
  const isAdmin = teamRoleQuery.data?.role === "ADMIN";

  const datasetsQuery = useQuery({
    ...trpc.lake.listDatasets.queryOptions({ teamId: selectedTeamId ?? "" }),
    enabled: !!selectedTeamId && lakeEnabled,
  });
  const datasets = datasetsQuery.data ?? [];

  const [pipelineId, setPipelineId] = useState<string>("");
  const [eventType, setEventType] = useState<string>(ALL_VALUE);
  const [queryText, setQueryText] = useState<string>("");
  const [rangeKey, setRangeKey] = useState<string>("1h");
  const [mode, setMode] = useState<"guided" | "raw">("guided");
  const [rawWhere, setRawWhere] = useState<string>("");
  const [applied, setApplied] = useState<AppliedSearch | null>(null);
  const [statsField, setStatsField] = useState<string>("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);

  const selectedDataset = datasets.find((d) => d.pipelineId === pipelineId);

  // Saved-search filter state, persisted via the shared FilterPreset model
  // (scope "lake_search", keyed by the dataset's environment).
  const presetFilters: Record<string, unknown> = {
    pipelineId,
    eventType,
    queryText,
    rangeKey,
    mode,
    rawWhere,
  };

  function applyPreset(filters: Record<string, unknown>) {
    if (typeof filters.pipelineId === "string") setPipelineId(filters.pipelineId);
    if (typeof filters.eventType === "string") setEventType(filters.eventType);
    if (typeof filters.queryText === "string") setQueryText(filters.queryText);
    if (typeof filters.rangeKey === "string") setRangeKey(filters.rangeKey);
    if (filters.mode === "raw" || filters.mode === "guided") setMode(filters.mode);
    if (typeof filters.rawWhere === "string") setRawWhere(filters.rawWhere);
  }

  function runSearch() {
    if (!pipelineId) return;
    const to = new Date();
    const from = new Date(to.getTime() - (RANGE_PRESETS[rangeKey]?.ms ?? RANGE_PRESETS["1h"].ms));
    setStatsField("");
    setApplied({
      mode,
      pipelineId,
      from,
      to,
      eventType:
        mode === "guided" && eventType !== ALL_VALUE ? (eventType as EventType) : undefined,
      query: mode === "guided" && queryText.trim() ? queryText.trim() : undefined,
      where: mode === "raw" && rawWhere.trim() ? rawWhere.trim() : undefined,
    });
  }

  const guidedSearch = useQuery({
    ...trpc.lake.search.queryOptions(
      applied && applied.mode === "guided"
        ? {
            pipelineId: applied.pipelineId,
            from: applied.from,
            to: applied.to,
            eventType: applied.eventType,
            query: applied.query,
          }
        : { pipelineId: "", from: EPOCH, to: EPOCH },
    ),
    enabled: !!applied && applied.mode === "guided",
  });

  const rawSearch = useQuery({
    ...trpc.lake.rawSearch.queryOptions(
      applied && applied.mode === "raw"
        ? {
            pipelineId: applied.pipelineId,
            from: applied.from,
            to: applied.to,
            where: applied.where ?? "",
          }
        : { pipelineId: "", from: EPOCH, to: EPOCH, where: "1" },
    ),
    enabled: !!applied && applied.mode === "raw" && !!applied.where,
  });

  const activeSearch = applied?.mode === "raw" ? rawSearch : guidedSearch;

  const schemaQuery = useQuery({
    ...trpc.lake.getSchema.queryOptions({ pipelineId }),
    enabled: !!pipelineId && lakeEnabled,
  });
  const schema = schemaQuery.data ?? [];

  const statsQuery = useQuery({
    ...trpc.lake.fieldStats.queryOptions(
      applied && statsField && pipelineId
        ? { pipelineId, field: statsField, from: applied.from, to: applied.to }
        : { pipelineId: "", field: "_", from: EPOCH, to: EPOCH },
    ),
    enabled: !!applied && !!statsField && !!pipelineId,
  });
  const stats = statsQuery.data ?? [];

  // ── Empty / gate states ──────────────────────────────────────────────────
  if (!statusQuery.isLoading && !lakeEnabled) {
    return (
      <div className="min-h-full bg-bg">
        <PageHeader title="Lake Search" description="Search events stored in the VectorFlow Lake." />
        <div className="p-4">
          <EmptyState
            icon={Database}
            title="Lake not configured"
            description="The VectorFlow Lake is not enabled on this deployment. Set VF_LAKE_CLICKHOUSE_URL (and restart) to store and search events in place."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-bg">
      <PageHeader
        title="Lake Search"
        description="Search logs, metrics and traces stored in the VectorFlow Lake."
      />

      <div className="space-y-6 p-4">
        {!selectedTeamId ? (
          <EmptyState
            icon={Users}
            title="Select a team"
            description="Choose a team from the selector to browse its lake datasets."
            compact
          />
        ) : (
          <>
            {/* Query builder */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Query</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-end gap-4">
                  {/* Dataset picker */}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="lake-dataset" className="text-xs text-muted-foreground">
                      Dataset
                    </label>
                    <Select value={pipelineId} onValueChange={setPipelineId}>
                      <SelectTrigger id="lake-dataset" className="w-[260px]">
                        <SelectValue placeholder="Select a dataset" />
                      </SelectTrigger>
                      <SelectContent>
                        {datasets.length === 0 ? (
                          <SelectItem value={ALL_VALUE} disabled>
                            No datasets yet
                          </SelectItem>
                        ) : (
                          datasets.map((d) => (
                            <SelectItem key={d.id} value={d.pipelineId}>
                              {d.pipeline.name} · {d.environment.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Time range */}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="lake-range" className="text-xs text-muted-foreground">
                      Time range
                    </label>
                    <Select value={rangeKey} onValueChange={setRangeKey}>
                      <SelectTrigger id="lake-range" className="w-[170px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RANGE_PRESETS).map(([key, { label }]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Tabs
                  value={mode}
                  onValueChange={(v) => setMode(v === "raw" ? "raw" : "guided")}
                  className="mt-4"
                >
                  <TabsList>
                    <TabsTrigger value="guided" className="gap-1.5">
                      <Search className="h-4 w-4" />
                      Guided
                    </TabsTrigger>
                    {isAdmin && (
                      <TabsTrigger value="raw" className="gap-1.5">
                        <ListTree className="h-4 w-4" />
                        Raw SQL
                      </TabsTrigger>
                    )}
                  </TabsList>

                  <TabsContent value="guided" className="space-y-4">
                    <div className="flex flex-wrap items-end gap-4">
                      <div className="flex flex-col gap-2">
                        <label htmlFor="lake-event-type" className="text-xs text-muted-foreground">
                          Event type
                        </label>
                        <Select value={eventType} onValueChange={setEventType}>
                          <SelectTrigger id="lake-event-type" className="w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ALL_VALUE}>All types</SelectItem>
                            <SelectItem value="log">log</SelectItem>
                            <SelectItem value="metric">metric</SelectItem>
                            <SelectItem value="trace">trace</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-1 flex-col gap-2">
                        <label htmlFor="lake-query" className="text-xs text-muted-foreground">
                          Search text
                        </label>
                        <Input
                          id="lake-query"
                          placeholder="Match message or raw payload…"
                          value={queryText}
                          onChange={(e) => setQueryText(e.target.value)}
                          className="min-w-[240px]"
                        />
                      </div>
                    </div>
                  </TabsContent>

                  {isAdmin && (
                    <TabsContent value="raw" className="space-y-2">
                      <label htmlFor="lake-raw" className="text-xs text-muted-foreground">
                        Filter expression (ClickHouse WHERE) — org, pipeline, time and row caps are
                        always enforced. Subqueries and statements are rejected.
                      </label>
                      <Textarea
                        id="lake-raw"
                        placeholder="severity = 'error' AND host LIKE '%db%'"
                        value={rawWhere}
                        onChange={(e) => setRawWhere(e.target.value)}
                        className="font-mono text-xs"
                        rows={3}
                      />
                    </TabsContent>
                  )}
                </Tabs>

                <div className="mt-4 flex items-center gap-3">
                  <Button onClick={runSearch} disabled={!pipelineId} className="gap-1.5">
                    <Play className="h-4 w-4" />
                    Run search
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setReplayOpen(true)}
                    disabled={!selectedDataset}
                    className="gap-1.5"
                  >
                    <Rewind className="h-4 w-4" />
                    Replay to pipeline
                  </Button>
                  {selectedDataset && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {Number(selectedDataset.rowCount).toLocaleString()} rows ·{" "}
                      {formatBytes(selectedDataset.byteCount)} ·{" "}
                      <Badge variant="secondary" className="ml-1">
                        {selectedDataset.tiering}
                      </Badge>
                    </span>
                  )}
                </div>
                {selectedDataset && (
                  <div className="mt-3">
                    <FilterPresetBar
                      environmentId={selectedDataset.environmentId}
                      scope="lake_search"
                      currentFilters={presetFilters}
                      onApplyPreset={applyPreset}
                      onSaveClick={() => setSaveOpen(true)}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Results + schema browser */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <LakeResultsTable
                    rows={activeSearch.data ?? []}
                    isLoading={activeSearch.isLoading && !!applied}
                    isError={activeSearch.isError}
                    hasSearched={!!applied}
                    onRetry={() => activeSearch.refetch()}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Schema</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {!pipelineId ? (
                    <p className="text-xs text-muted-foreground">Select a dataset to inspect its fields.</p>
                  ) : schema.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {schemaQuery.isLoading ? "Loading schema…" : "No fields discovered yet."}
                    </p>
                  ) : (
                    schema.map((field) => (
                      <button
                        key={field.name}
                        type="button"
                        onClick={() => setStatsField(field.name)}
                        className={`flex w-full items-center justify-between gap-2 rounded-[3px] px-2 py-1 text-left text-xs hover:bg-bg-2 ${
                          statsField === field.name ? "bg-bg-2" : ""
                        }`}
                      >
                        <span className="truncate font-mono">{field.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {field.kind}
                        </span>
                      </button>
                    ))
                  )}

                  {statsField && (
                    <div className="mt-3 border-t border-line pt-3">
                      <p className="mb-2 font-mono text-[11px] text-muted-foreground">
                        Top values · {statsField}
                      </p>
                      {!applied ? (
                        <p className="text-xs text-muted-foreground">Run a search to compute stats.</p>
                      ) : statsQuery.isLoading ? (
                        <p className="text-xs text-muted-foreground">Computing…</p>
                      ) : stats.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No values.</p>
                      ) : (
                        <div className="space-y-1">
                          {stats.map((s) => (
                            <div
                              key={s.value}
                              className="flex items-center justify-between gap-2 font-mono text-[11px]"
                            >
                              <span className="truncate" title={s.value}>
                                {s.value || "(empty)"}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {s.count.toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {selectedDataset && (
          <SaveFilterDialog
            open={saveOpen}
            onOpenChange={setSaveOpen}
            environmentId={selectedDataset.environmentId}
            scope="lake_search"
            filters={presetFilters}
          />
        )}

        {selectedDataset && (
          <ReplayDialog
            open={replayOpen}
            onOpenChange={setReplayOpen}
            sourcePipelineId={selectedDataset.pipelineId}
            sourcePipelineName={selectedDataset.pipeline.name}
            environmentId={selectedDataset.environmentId}
            defaultEventType={eventType}
            defaultQuery={queryText}
          />
        )}
      </div>
    </div>
  );
}
