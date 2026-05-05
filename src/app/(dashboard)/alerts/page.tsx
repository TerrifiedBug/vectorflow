"use client";

import Link from "next/link";
import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertRulesSection } from "./_components/alert-rules-section";
import { NotificationChannelsSection } from "./_components/notification-channels-section";
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
    initialTab === "anomalies" || initialTab === "flat" ? "flat" : "grouped"
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
  const criticalCount = rules.filter((rule) => rule.severity === "critical").length;
  const warningCount = rules.filter((rule) => rule.severity === "warning").length;
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Configure alert rules, notification channels, and review alert history."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setTopTab("channels")}>
              <Bell className="h-3.5 w-3.5" />
              Notification channels
            </Button>
            <Button variant="primary" size="sm" asChild>
              <Link href="/alerts/new">
                <Plus className="h-3.5 w-3.5" />
                New rule
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-2">
        <Badge variant="outline" className="rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em] text-status-error">
          {criticalCount} critical
        </Badge>
        <Badge variant="outline" className="rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em] text-status-degraded">
          {warningCount} warning
        </Badge>
        <span>{rules.length} rules</span>
        <span>·</span>
        <span>{firingEvents.length} firing now</span>
      </div>

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
                <TabsTrigger value="grouped" className="gap-1.5">
                  <Layers className="h-4 w-4" />
                  Grouped
                </TabsTrigger>
                <TabsTrigger value="flat" className="gap-1.5">
                  <List className="h-4 w-4" />
                  All Events
                </TabsTrigger>
              </TabsList>

              <TabsContent value="grouped">
                <div className="space-y-6">
                  <CorrelatedAlertHistory
                    environmentId={selectedEnvironmentId}
                  />
                </div>
              </TabsContent>

              <TabsContent value="flat">
                <AlertHistorySection
                  environmentId={selectedEnvironmentId}
                  initialCategory={initialTab === "anomalies" ? "anomalies" : undefined}
                />
              </TabsContent>
            </Tabs>

            <FailedDeliveriesSection
              environmentId={selectedEnvironmentId}
            />
          </div>
        </TabsContent>
      </Tabs>
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
    <Card className="overflow-hidden border-line bg-bg-2">
      <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
        <CardTitle className="font-mono text-[14px] font-medium text-fg">
          Firing & recent
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <div className="px-4 py-6 font-mono text-[11.5px] text-fg-2">
            No alerts are currently firing.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[32px]" />
                <TableHead>Severity</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Node</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id} className="font-mono text-[11.5px]">
                  <TableCell className="p-0">
                    <div className="h-10 w-[3px] bg-status-error" />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em] ${severityClass(event.alertRule.severity)}`}>
                      {event.alertRule.severity ?? "alert"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-fg">{event.alertRule.name}</div>
                    <div className="text-[10.5px] text-fg-2">
                      {event.alertRule.metric} {event.alertRule.condition ?? ""} {event.alertRule.threshold ?? ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-status-error">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-error" />
                      firing
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-2">
                    {formatSince(event.firedAt)}
                  </TableCell>
                  <TableCell className="text-fg-1">
                    {event.alertRule.pipeline?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-fg-2">
                    {event.node?.host ?? "fleet"}
                  </TableCell>
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

function severityClass(severity: string | undefined) {
  if (severity === "critical") return "border-status-error/40 bg-status-error-bg text-status-error";
  if (severity === "warning") return "border-status-degraded/40 bg-status-degraded-bg text-status-degraded";
  if (severity === "info") return "border-status-info/40 bg-status-info-bg text-status-info";
  return "border-line-2 bg-bg-2 text-fg-1";
}
