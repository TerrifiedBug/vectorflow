"use client";

import { useState } from "react";
import { useEnvironmentStore } from "@/stores/environment-store";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Bell,
  Clock,
  Layers,
  List,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";

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
  const [topTab, setTopTab] = useState<"rules" | "channels" | "history">(
    "rules",
  );
  const [alertView, setAlertView] = useState<"grouped" | "flat" | "anomalies">(
    "grouped",
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

  return (
    <div className="space-y-6">
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
              <Badge
                variant="outline"
                className="ml-1 border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 tabular-nums"
              >
                {totalAnomalies}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Rules Tab ─────────────────────────────────────── */}
        <TabsContent value="rules">
          <AlertRulesSection environmentId={selectedEnvironmentId} />
        </TabsContent>

        {/* ── Channels Tab ──────────────────────────────────── */}
        <TabsContent value="channels">
          <div className="space-y-6">
            <NotificationChannelsSection
              environmentId={selectedEnvironmentId}
            />
            <WebhooksSection environmentId={selectedEnvironmentId} />
          </div>
        </TabsContent>

        {/* ── History Tab ───────────────────────────────────── */}
        <TabsContent value="history">
          <div className="space-y-6">
            <Tabs
              value={alertView}
              onValueChange={(v) =>
                setAlertView(v as "grouped" | "flat" | "anomalies")
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
                <CorrelatedAlertHistory
                  environmentId={selectedEnvironmentId}
                />
              </TabsContent>

              <TabsContent value="flat">
                <AlertHistorySection
                  environmentId={selectedEnvironmentId}
                />
              </TabsContent>

              <TabsContent value="anomalies">
                <AnomalyHistorySection
                  environmentId={selectedEnvironmentId}
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
