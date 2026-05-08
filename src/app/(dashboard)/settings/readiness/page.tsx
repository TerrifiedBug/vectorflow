"use client";

import { ReadinessSection } from "../_components/readiness-section";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";

export default function ReadinessPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Readiness"
        subtitle="Aggregated health and configuration checklist for this VectorFlow instance."
      />
      <div className="space-y-4 p-4">
        <EmptyState
          glyph="OPS"
          title="Readiness checks run server-side"
          description="The checklist below loads the productionReadiness query and reports configuration, fleet, deployment, and operational signals. If the query fails, the page shows a retryable diagnostic instead of pretending the instance is ready."
          helperLines={[
            { icon: "load", text: "Loading shows skeleton rows while the readiness query is in flight." },
            { icon: "fail", text: "Errors remain visible through the retry control in the checklist section." },
          ]}
          compact
          className="min-h-[180px]"
        />
        <ReadinessSection />
      </div>
    </div>
  );
}
