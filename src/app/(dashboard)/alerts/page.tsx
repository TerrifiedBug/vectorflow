"use client";

import { useEnvironmentStore } from "@/stores/environment-store";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";

import { AlertRulesSection } from "./_components/alert-rules-section";
import { NotificationChannelsSection } from "./_components/notification-channels-section";
import { WebhooksSection } from "./_components/webhooks-section";
import { AlertHistorySection } from "./_components/alert-history-section";
import { FailedDeliveriesSection } from "./_components/failed-deliveries-section";

// ─── Alerts Page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
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
      <AlertRulesSection environmentId={selectedEnvironmentId} />

      <Separator />

      <NotificationChannelsSection environmentId={selectedEnvironmentId} />

      <WebhooksSection environmentId={selectedEnvironmentId} />

      <Separator />

      <AlertHistorySection environmentId={selectedEnvironmentId} />

      <Separator />

      <FailedDeliveriesSection environmentId={selectedEnvironmentId} />
    </div>
  );
}
