"use client";

import { PageTransition } from "@/components/motion/page-transition";

export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PageTransition>{children}</PageTransition>;
}
