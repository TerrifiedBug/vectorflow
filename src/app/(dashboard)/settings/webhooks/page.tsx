import { redirect } from "next/navigation";

// Outbound webhook configuration moved to Alerts > Channels so all webhook
// surfaces live next to alert rules + notification channels. Anyone who has
// the old /settings/webhooks URL bookmarked lands in the new location.
export default function WebhooksRedirectPage() {
  redirect("/alerts?tab=channels");
}
