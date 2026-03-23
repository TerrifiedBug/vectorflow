"use client";

import { useEnvironmentStore } from "@/stores/environment-store";
import { Separator } from "@/components/ui/separator";

import { AlertRulesSection } from "./_components/alert-rules-section";
import { NotificationChannelsSection } from "./_components/notification-channels-section";
import { WebhooksSection } from "./_components/webhooks-section";
import { AlertHistorySection } from "./_components/alert-history-section";

// ─── Alerts Page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );

  if (!selectedEnvironmentId) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            Select an environment to manage alerts.
          </p>
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

      <AlertHistorySection environmentId={selectedEnvironmentId} />
    </div>
  );
}
