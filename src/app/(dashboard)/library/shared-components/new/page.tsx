import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Per-Vector-component configuration schemas are explicitly not designed for v2.0.
 * Keep this route stable, but do not expose raw schema-driven creation as finished UI.
 */
export default function NewSharedComponentPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="New shared component"
        subtitle="This route is reserved for reusable Vector component configuration once each kind has an approved design."
        breadcrumb={<span>library / shared components / new</span>}
      />
      <EmptyState
        glyph="SC"
        title="Shared component creation is not designed yet"
        description="The v2.0 handoff calls out per-component config drawers and schemas as not yet designed. This route stays available, but creation is gated so users do not mistake a raw schema browser for an approved workflow."
        secondary={{ label: "Back to shared components", href: "/library/shared-components" }}
        helperLines={[
          { icon: "scope", text: "Source of truth: HANDOFF §2 and §12 flag per-Vector-component config schemas as design-pending." },
          { icon: "gate", text: "Requires approved source, transform, and sink configuration surfaces before enabling creation." },
        ]}
      />
    </div>
  );
}
