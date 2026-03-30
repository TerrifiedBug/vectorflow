"use client";

import { useState } from "react";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Layers, List } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";

import { Skeleton } from "@/components/ui/skeleton";
import { AlertRulesSection } from "./_components/alert-rules-section";
import { NotificationChannelsSection } from "./_components/notification-channels-section";
import { WebhooksSection } from "./_components/webhooks-section";
import { AlertHistorySection } from "./_components/alert-history-section";
import { CorrelatedAlertHistory } from "./_components/correlated-alert-history";
import { FailedDeliveriesSection } from "./_components/failed-deliveries-section";
import { AnomalyHistorySection } from "./_components/anomaly-history-section";

// ─── Alerts Page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );
  const [alertView, setAlertView] = useState<"grouped" | "flat" | "anomalies">("grouped");

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
      <AlertRulesSection environmentId={selectedEnvironmentId} />

      <Separator />

      <NotificationChannelsSection environmentId={selectedEnvironmentId} />

      <WebhooksSection environmentId={selectedEnvironmentId} />

      <Separator />

      {/* Alert History: Grouped vs Flat toggle */}
      <Tabs
        value={alertView}
        onValueChange={(v) => setAlertView(v as "grouped" | "flat" | "anomalies")}
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
          <TabsTrigger value="anomalies" className="gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Anomalies
            {totalAnomalies > 0 && (
              <Badge
                variant="outline"
                className="ml-1 border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 tabular-nums"
              >
                {totalAnomalies}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="grouped">
          <CorrelatedAlertHistory environmentId={selectedEnvironmentId} />
        </TabsContent>

        <TabsContent value="flat">
          <AlertHistorySection environmentId={selectedEnvironmentId} />
        </TabsContent>

        <TabsContent value="anomalies">
          <AnomalyHistorySection environmentId={selectedEnvironmentId} />
        </TabsContent>
      </Tabs>

      <Separator />

      <FailedDeliveriesSection environmentId={selectedEnvironmentId} />
    </div>
  );
}
