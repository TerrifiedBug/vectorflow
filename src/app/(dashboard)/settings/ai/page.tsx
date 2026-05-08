import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function AiPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="AI"
        subtitle="AI assistant configuration is reserved for a feature-flagged v2.1 rollout."
      />
      <EmptyState
        glyph="AI"
        title="AI settings are feature-flagged off"
        description="The AI assistant is out of scope for the default v2.0 UI. This page remains routable, but configuration is unavailable until the feature flag and release plan are approved."
        helperLines={[
          { icon: "flag", text: "Feature flag required before exposing LLM provider or assistant settings." },
          { icon: "scope", text: "Source of truth: HANDOFF §13 gates the AI assistant behind a feature flag." },
        ]}
      />
    </div>
  );
}
