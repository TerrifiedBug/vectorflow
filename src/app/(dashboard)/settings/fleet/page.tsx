"use client";

import { FleetSettings } from "../_components/fleet-settings";
import { PageHeader } from "@/components/ui/page-header";

export default function FleetPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Fleet"
        subtitle="View and manage fleet nodes and their agent configuration."
      />
      <div className="space-y-4 p-4">
        <FleetSettings />
      </div>
    </div>
  );
}
