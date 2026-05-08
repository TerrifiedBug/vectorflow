"use client";

import { TeamSettings } from "../_components/team-settings";
import { PageHeader } from "@/components/ui/page-header";

export default function TeamPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="My Team"
        subtitle="Configure your team's name, environments, and preferences."
      />
      <div className="space-y-4 p-4">
        <TeamSettings />
      </div>
    </div>
  );
}
