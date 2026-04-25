import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/is-demo-mode";
import TeamPageClient from "./_client";

export default async function TeamPage() {
  if (isDemoMode()) notFound();
  return <TeamPageClient />;
}
