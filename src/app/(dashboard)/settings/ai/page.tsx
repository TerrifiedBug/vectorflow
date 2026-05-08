"use client";

import { AiSettings } from "../_components/ai-settings";
import { PageHeader } from "@/components/ui/page-header";

export default function AiPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="AI"
        subtitle="Configure AI assistance for VRL and pipeline generation."
      />
      <div className="space-y-4 p-4">
        <AiSettings />
      </div>
    </div>
  );
}