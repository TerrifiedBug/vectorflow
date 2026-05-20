import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/is-demo-mode";
import { PageHeader } from "@/components/ui/page-header";
import { OrganizationSettings } from "../_components/organization-settings";

export default async function OrganizationPage() {
  if (isDemoMode()) notFound();
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Organisation"
        subtitle="Members and ownership of this organisation."
      />
      <div className="space-y-4 p-4">
        <OrganizationSettings />
      </div>
    </div>
  );
}
