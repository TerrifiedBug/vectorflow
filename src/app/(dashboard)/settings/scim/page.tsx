"use client";

import { ScimSettings } from "../_components/scim-settings";
import { PageHeader } from "@/components/ui/page-header";

export default function ScimPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="SCIM"
        subtitle="Provision users and groups from your identity provider."
      />
      <div className="space-y-4 p-4">
        <ScimSettings />
      </div>
    </div>
  );
}
