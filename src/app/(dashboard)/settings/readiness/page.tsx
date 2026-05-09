"use client";

import { ReadinessSection } from "../_components/readiness-section";
import { PageHeader } from "@/components/ui/page-header";

export default function ReadinessPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Readiness"
        subtitle="Aggregated health and configuration checklist for this VectorFlow instance."
      />
      <div className="space-y-4 p-4">
        <ReadinessSection />
      </div>
    </div>
  );
}
