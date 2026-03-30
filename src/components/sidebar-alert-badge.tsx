"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { SidebarMenuBadge } from "@/components/ui/sidebar";

export function SidebarAlertBadge() {
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const { data: stats } = useQuery({
    ...trpc.dashboard.stats.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: 30_000,
  });

  const count = stats?.alerts ?? 0;

  if (count === 0) return null;

  return (
    <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
      {count > 99 ? "99+" : count}
    </SidebarMenuBadge>
  );
}
