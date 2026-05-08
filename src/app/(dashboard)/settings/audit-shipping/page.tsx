"use client";

import { AuditLogShippingSection } from "../_components/audit-shipping-section";
import { PageHeader } from "@/components/ui/page-header";

export default function AuditShippingPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Audit Log Shipping"
        subtitle="Ship audit logs to an external SIEM or logging service."
      />
      <div className="space-y-4 p-4">
        <AuditLogShippingSection />
      </div>
    </div>
  );
}
