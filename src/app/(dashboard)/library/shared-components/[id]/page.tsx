import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Shared-component detail depends on per-kind Vector configuration UX that is not in the v2.0 canvas.
 * Keep deep links truthful instead of rendering the raw schema editor as product UI.
 */
export default function SharedComponentDetailPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Shared component detail"
        subtitle="Reusable component inspection and editing need an approved per-kind configuration surface before they can ship."
        breadcrumb={<span>library / shared components / detail</span>}
      />
      <EmptyState
        glyph="SC"
        title="Shared component details are not available in v2.0"
        description="The current v2.0 spec does not define the detail editor for shared Vector components. This route is intentionally gated rather than presenting raw schema fields, linked-pipeline actions, or destructive controls as if they were designed."
        secondary={{ label: "Back to shared components", href: "/library/shared-components" }}
        helperLines={[
          { icon: "scope", text: "Coming soon — per-component config editing is not part of the current shipped surface." },
          { icon: "gate", text: "Requires design approval before showing configuration editing, linked-pipeline updates, or delete actions here." },
        ]}
      />
    </div>
  );
}
