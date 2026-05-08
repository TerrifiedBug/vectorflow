"use client";

import { ScimSettings } from "../_components/scim-settings";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";

export default function ScimPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="SCIM"
        subtitle="Provision users and groups from your identity provider."
      />
      <div className="space-y-4 p-4">
        <EmptyState
          glyph="SCIM"
          title="SCIM provisioning is gated in this surface"
          description="Configuration status, base URL, and token state are shown below. Mutating SCIM controls are disabled in the public demo; the configured state is read from the backend settings endpoint."
          helperLines={[
            { icon: "truth", text: "This page reports the current SCIM settings query instead of hiding the route behind an empty shell." },
            { icon: "scope", text: "Token generation and enablement are server-confirmed actions; no optimistic provisioning changes are applied." },
          ]}
          compact
          className="min-h-[180px]"
        />
        <ScimSettings />
      </div>
    </div>
  );
}
