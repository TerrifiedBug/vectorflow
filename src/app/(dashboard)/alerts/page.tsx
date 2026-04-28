"use client";

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
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { StatusBadge } from "@/components/ui/status-badge";

import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertRulesSection } from "./_components/alert-rules-section";
import { NotificationChannelsSection } from "./_components/notification-channels-section";
import { AlertHistorySection } from "./_components/alert-history-section";
import { AnomalyHistorySection } from "./_components/anomaly-history-section";
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
    initialTab === "anomalies" || initialTab === "flat" ? "history" : "rules",
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

  if (anomalyCountQuery.isLoading) {
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
      <PageHeader title="Alerts" description="Configure alert rules, notification channels, and review alert history." />

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
                  {/* Anomalies aren't part of AlertCorrelationGroup yet, but
                      they're peer signals during incident triage — surface them
                      directly under the grouped alerts so this view answers the
                      "what fired together" question for both alert types. */}
                  <AnomalyHistorySection
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
