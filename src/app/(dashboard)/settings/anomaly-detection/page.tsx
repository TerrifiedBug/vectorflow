"use client";

import { AnomalyDetectionSettings } from "../_components/anomaly-detection-settings";
import { PageHeader } from "@/components/ui/page-header";

export default function AnomalyDetectionPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Anomaly Detection"
        subtitle="Tune anomaly detection sensitivity, baseline windows, and monitored metrics."
      />
      <div className="space-y-4 p-4">
        <AnomalyDetectionSettings />
      </div>
    </div>
  );
}
