"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Workflow,
  Server,
  Layers,
  FileText,
  ScrollText,
  Settings,
} from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { TeamSelector } from "@/components/team-selector";
import { useTeamStore } from "@/stores/team-store";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Pipelines", href: "/pipelines", icon: Workflow },
  { title: "Fleet", href: "/fleet", icon: Server },
  { title: "Environments", href: "/environments", icon: Layers },
  { title: "Templates", href: "/templates", icon: FileText },
  { title: "Audit Log", href: "/audit", icon: ScrollText },
  { title: "Settings", href: "/settings", icon: Settings, requiredRole: "ADMIN" as const },
];

export function AppSidebar() {
  const pathname = usePathname();
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const roleQuery = useQuery(
    trpc.team.teamRole.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const userRole = roleQuery.data?.role;
  const isSuperAdmin = roleQuery.data?.isSuperAdmin ?? false;

  const visibleItems = navItems.filter((item) => {
    if (!item.requiredRole) return true;
    if (isSuperAdmin) return true;
    if (!userRole) return false;
    const roleLevel: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };
    return (roleLevel[userRole] ?? 0) >= (roleLevel[item.requiredRole] ?? 0);
  });

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">
            VectorFlow
          </span>
        </Link>
        <div className="px-3 pb-2">
          <TeamSelector />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
