"use client";

import { VersionCheckSection } from "../_components/version-check-section";
import { PageHeader } from "@/components/ui/page-header";

export default function VersionCheckPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Version Check"
        subtitle="Check for VectorFlow updates and view current version info."
      />
      <div className="space-y-4 p-4">
        <VersionCheckSection />
      </div>
    </div>
  );
}
