"use client";

import { TeamsManagement } from "../_components/teams-management";
import { PageHeader } from "@/components/ui/page-header";

export default function TeamsPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="All Teams"
        subtitle="Create and manage teams for multi-tenant isolation."
      />
      <div className="space-y-4 p-4">
        <TeamsManagement />
      </div>
    </div>
  );
}
