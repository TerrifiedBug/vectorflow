import { OutboundWebhooksSection } from "./_components/outbound-webhooks-section";
import { PageHeader } from "@/components/ui/page-header";

export default function WebhooksPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Outbound Webhooks"
        subtitle="Forward events to external systems via HMAC-signed POSTs."
      />
      <div className="space-y-4 p-4">
        <OutboundWebhooksSection />
      </div>
    </div>
  );
}
