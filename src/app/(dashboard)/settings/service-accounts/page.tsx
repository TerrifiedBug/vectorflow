import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/is-demo-mode";
import ServiceAccountsPageClient from "./_client";

export default async function ServiceAccountsPage() {
  if (isDemoMode()) notFound();
  return <ServiceAccountsPageClient />;
}
