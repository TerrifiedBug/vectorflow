"use client";

import Link from "next/link";
import { type ComponentProps, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEnvironmentStore } from "@/stores/environment-store";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  Clock,
  Layers,
  List,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { PageHeader, PageHeaderMetaSep } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertRulesSection } from "./_components/alert-rules-section";
import { NotificationChannelsSection } from "./_components/notification-channels-section";
import { QueryError } from "@/components/query-error";
import { AlertHistorySection } from "./_components/alert-history-section";
import { CorrelatedAlertHistory } from "./_components/correlated-alert-history";
import { FailedDeliveriesSection } from "./_components/failed-deliveries-section";

// ─── Alerts Page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [topTab, setTopTab] = useState<"rules" | "channels" | "history">(
    initialTab === "channels"
      ? "channels"
      : initialTab === "history" || initialTab === "anomalies" || initialTab === "flat"
        ? "history"
        : "rules",
  );
  const [alertView, setAlertView] = useState<"grouped" | "flat">(
    initialTab === "grouped" ? "grouped" : "flat"
  );

  const trpc = useTRPC();

  const anomalyCountQuery = useQuery(
    trpc.anomaly.countByPipeline.queryOptions(
      { environmentId: selectedEnvironmentId ?? "" },
      { enabled: !!selectedEnvironmentId },
    ),
  );
  const rulesQuery = useQuery(
    trpc.alert.listRules.queryOptions(
      { environmentId: selectedEnvironmentId ?? "" },
      { enabled: !!selectedEnvironmentId },
    ),
  );
  const firingEventsQuery = useQuery(
    trpc.alert.listEvents.queryOptions(
      { environmentId: selectedEnvironmentId ?? "", status: "firing", limit: 10 },
      { enabled: !!selectedEnvironmentId, refetchInterval: 10_000 },
    ),
  );

  const rules = rulesQuery.data ?? [];
  const firingEvents = firingEventsQuery.data?.items ?? [];
  const totalAnomalies = Object.values(anomalyCountQuery.data ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );

  if (!selectedEnvironmentId) {
    return (
      <div className="space-y-6">
        <EmptyState title="Select an environment to manage alerts." />
      </div>
    );
  }

  if (anomalyCountQuery.isLoading || rulesQuery.isLoading || firingEventsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-9 w-28" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </div>
        <Skeleton className="h-px w-full" />
        <div className="space-y-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-10 w-64" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (anomalyCountQuery.isError || rulesQuery.isError || firingEventsQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError
          message="Failed to load alert data"
          onRetry={() => {
            anomalyCountQuery.refetch();
            rulesQuery.refetch();
            firingEventsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-bg">
      <PageHeader
        title="Alerts"
        subtitle="Configure alert rules, notification channels, and review alert history."
        meta={
          <>
            <span>{rules.length} rules</span>
            <PageHeaderMetaSep />
            <span>{firingEvents.length} firing now</span>
            <PageHeaderMetaSep />
            <span>{totalAnomalies} anomalies</span>
          </>
        }
        actions={
          <Button variant="primary" size="sm" asChild>
            <Link href="/alerts/new">
              <Plus className="h-3.5 w-3.5" />
              New rule
            </Link>
          </Button>
        }
      />

      <div className="space-y-6 p-4">


      <FiringAndRecentCard events={firingEvents} />

      <Tabs
        value={topTab}
        onValueChange={(v) =>
          setTopTab(v as "rules" | "channels" | "history")
        }
      >
        <TabsList>
          <TabsTrigger value="rules" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            Rules
          </TabsTrigger>
          <TabsTrigger value="channels" className="gap-1.5">
            <Bell className="h-4 w-4" />
            Channels
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Clock className="h-4 w-4" />
            History
            {totalAnomalies > 0 && (
              <StatusBadge variant="error" className="ml-1">
                {totalAnomalies}
              </StatusBadge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Rules Tab ─────────────────────────────────────── */}
        <TabsContent value="rules">
          <AlertRulesSection environmentId={selectedEnvironmentId} />
        </TabsContent>

        {/* ── Channels Tab ──────────────────────────────────── */}
        <TabsContent value="channels">
          <NotificationChannelsSection
            environmentId={selectedEnvironmentId}
          />
        </TabsContent>

        {/* ── History Tab ───────────────────────────────────── */}
        <TabsContent value="history">
          <div className="space-y-6">
            <Tabs
              value={alertView}
              onValueChange={(v) =>
                setAlertView(v as "grouped" | "flat")
              }
            >
              <TabsList>
                <TabsTrigger value="flat" className="gap-1.5">
                  <List className="h-4 w-4" />
                  All Events
                </TabsTrigger>
                <TabsTrigger value="grouped" className="gap-1.5">
                  <Layers className="h-4 w-4" />
                  Grouped
                </TabsTrigger>
              </TabsList>

              <TabsContent value="flat">
                <AlertHistorySection
                  environmentId={selectedEnvironmentId}
                  initialCategory={initialTab === "anomalies" ? "anomalies" : undefined}
                />
              </TabsContent>

              <TabsContent value="grouped">
                <div className="space-y-6">
                  <CorrelatedAlertHistory
                    environmentId={selectedEnvironmentId}
                  />
                </div>
              </TabsContent>
            </Tabs>

            <FailedDeliveriesSection
              environmentId={selectedEnvironmentId}
            />
          </div>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}

type FiringEvent = {
  id: string;
  status: string;
  value: number;
  message: string | null;
  firedAt: Date | string;
  alertRule: {
    id: string;
    name: string;
    metric: string;
    condition: string | null;
    threshold: number | null;
    severity?: string;
    pipeline: { id: string; name: string } | null;
  };
  node: { id: string; host: string } | null;
};

function FiringAndRecentCard({ events }: { events: FiringEvent[] }) {
  return (
    <Card className="overflow-hidden rounded-[3px] border-line bg-bg-2">
      <CardHeader className="border-b border-line bg-bg-1 px-[14px] py-3">
        <CardTitle className="font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-fg">
          Firing & recent
        </CardTitle>
      </CardHeader>
      <CardContent className="p-[14px]">
        {events.length === 0 ? (
          <div className="font-mono text-[11.5px] text-fg-2">
            No alerts are currently firing.
          </div>
        ) : (
          <Table density="dense" className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[14%]">Severity</TableHead>
                <TableHead className="w-[34%]">Rule</TableHead>
                <TableHead className="w-[20%]">Target</TableHead>
                <TableHead className="w-[12%]">Status</TableHead>
                <TableHead className="w-[10%]">Since</TableHead>
                <TableHead className="hidden xl:table-cell w-[10%]">Node</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id} className="font-mono text-[11.5px]">
                  <TableCell className="align-top">
                    <Pill variant={severityVariant(event.alertRule.severity)} size="xs">
                      {event.alertRule.severity ?? "alert"}
                    </Pill>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="min-w-0">
                      <div className="truncate text-fg">{event.alertRule.name}</div>
                      <div className="truncate text-[10.5px] text-fg-2">
                        {event.alertRule.metric} {event.alertRule.condition ?? ""} {event.alertRule.threshold ?? ""}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-fg-1">
                    <span className="block truncate">{event.alertRule.pipeline?.name ?? event.node?.host ?? "fleet"}</span>
                  </TableCell>
                  <TableCell className="align-top">
                    <span className="inline-flex items-center gap-1.5 text-status-error">
                      <StatusDot variant="error" size={6} pulse />
                      firing
                    </span>
                  </TableCell>
                  <TableCell className="align-top text-fg-2">{formatSince(event.firedAt)}</TableCell>
                  <TableCell className="hidden xl:table-cell align-top text-fg-2">{event.node?.host ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}


function formatSince(date: Date | string) {
  const fired = typeof date === "string" ? new Date(date) : date;
  const minutes = Math.max(0, Math.round((Date.now() - fired.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m ago` : `${hours}h ago`;
}

function severityVariant(severity: string | undefined): ComponentProps<typeof Pill>["variant"] {
  if (severity === "critical") return "error";
  if (severity === "warning") return "warn";
  if (severity === "info") return "info";
  return "status";
}
