import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/is-demo-mode";
import TelemetrySettingsClient from "./_client";

export default async function TelemetrySettingsPage() {
  if (isDemoMode()) notFound();
  return <TelemetrySettingsClient />;
}
