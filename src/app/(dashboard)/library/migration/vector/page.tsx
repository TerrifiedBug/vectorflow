import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Vector config import is a migration workflow, but it has no approved v2.0 canvas.
 * Gate the route instead of shipping a finished-looking parser/import wizard.
 */
export default function VectorMigrationPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Import Vector config"
        subtitle="Bulk import from existing Vector configs needs a designed review and recovery workflow before it can ship."
        breadcrumb={<span>library / migration / vector</span>}
      />
      <EmptyState
        glyph="VF"
        title="Vector config import is pending design"
        description="The current v2.0 spec does not define the upload, topology review, subgraph selection, or import result states for Vector config migration. This route is gated so users do not mistake parser output for an approved production workflow."
        secondary={{ label: "Back to migration library", href: "/library/migration" }}
        helperLines={[
          { icon: "scope", text: "Coming soon — Vector config import is not part of the current shipped surface." },
          { icon: "gate", text: "Requires approved topology review, validation diagnostics, and import recovery states before enabling uploads." },
        ]}
      />
    </div>
  );
}
