import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/is-demo-mode";
import UsersPageClient from "./_client";

export default async function UsersPage() {
  if (isDemoMode()) notFound();
  return <UsersPageClient />;
}
