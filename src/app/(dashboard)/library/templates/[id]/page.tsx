import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Per-template detail is explicitly not designed for v2.0.
 * Keep the route stable, but do not present a finished surface until design approves it.
 */
export default function TemplateDetailPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Template detail"
        subtitle="This route is reserved for a future per-template workflow. The v2.0 spec includes the gallery, but not this detail surface."
        breadcrumb={<span>library / templates / detail</span>}
      />
      <EmptyState
        glyph="◇"
        title="Template details are not available in v2.0"
        description="Per-template detail pages do not have an approved v2 design. Use the templates gallery for now; this route stays in place so existing links fail truthfully instead of showing invented UI."
        secondary={{ label: "Back to templates", href: "/library/templates" }}
        helperLines={[
          { icon: "scope", text: "Coming soon — per-template detail is not part of the current shipped surface." },
          { icon: "gate", text: "Requires design approval before adding template graph, usage, or create-from-template controls." },
        ]}
      />
    </div>
  );
}
