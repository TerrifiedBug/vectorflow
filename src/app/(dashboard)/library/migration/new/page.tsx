import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * The FluentD-to-Vector migration creation wizard is not part of the v2.0 designed surface set.
 * Keep the route truthful until product/design define the workflow and error states.
 */
export default function NewMigrationPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="New migration project"
        subtitle="Migration project creation is reserved until the v2 design defines the workflow, validation, and recovery states."
        breadcrumb={<span>library / migration / new</span>}
      />
      <EmptyState
        glyph="MI"
        title="Migration creation is pending design"
        description="The current handoff does not include a designed migration wizard. This route stays stable, but upload, parse, AI translation, and pipeline-generation controls are gated so the product does not imply unsupported completeness."
        secondary={{ label: "Back to migration library", href: "/library/migration" }}
        helperLines={[
          { icon: "scope", text: "Coming soon — migration creation is not part of the current shipped surface." },
          { icon: "gate", text: "Requires approved creation flow, diagnostics, and recovery actions before accepting configs." },
        ]}
      />
    </div>
  );
}
