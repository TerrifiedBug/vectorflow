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
  Bell,
  BarChart3,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  ArrowLeft,
} from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useTeamStore } from "@/stores/team-store";
import { useEnvironmentStore } from "@/stores/environment-store";
import { settingsNavGroups } from "@/components/settings-sidebar-nav";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Pipelines", href: "/pipelines", icon: Workflow },
  { title: "Fleet", href: "/fleet", icon: Server },
  { title: "Environments", href: "/environments", icon: Layers },
  { title: "Library", href: "/library", icon: FileText },
  { title: "Audit Log", href: "/audit", icon: ScrollText },
  { title: "Alerts", href: "/alerts", icon: Bell },
  { title: "Analytics", href: "/analytics", icon: BarChart3 },
  { title: "Settings", href: "/settings", icon: Settings, requiredRole: "ADMIN" as const },
];

/** Nav items visible when the system environment is selected */
const SYSTEM_ENV_ALLOWED_HREFS = new Set(["/", "/pipelines"]);

export function AppSidebar() {
  const pathname = usePathname();
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const isSystemEnvironment = useEnvironmentStore((s) => s.isSystemEnvironment);
  const roleQuery = useQuery(
    trpc.team.teamRole.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const userRole = roleQuery.data?.role;
  const isSuperAdmin = roleQuery.data?.isSuperAdmin ?? false;

  const visibleItems = navItems.filter((item) => {
    // When system environment is selected, only show allowed nav items
    if (isSystemEnvironment && !SYSTEM_ENV_ALLOWED_HREFS.has(item.href)) {
      return false;
    }
    if (!item.requiredRole) return true;
    if (isSuperAdmin) return true;
    if (!userRole) return false;
    const roleLevel: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };
    return (roleLevel[userRole] ?? 0) >= (roleLevel[item.requiredRole] ?? 0);
  });

  const isSettingsMode = pathname.startsWith("/settings");

  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-0">
        <div className="flex h-14 items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
          {isSettingsMode ? (
            <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
              <span className="group-data-[collapsible=icon]:hidden">Settings</span>
            </Link>
          ) : (
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl tracking-tight group-data-[collapsible=icon]:hidden">
                <span className="font-bold">Vector</span>
                <span className="font-light">Flow</span>
              </span>
              <span className="hidden text-xl group-data-[collapsible=icon]:block">
                <span className="font-bold">V</span><span className="font-light">f</span>
              </span>
            </Link>
          )}
        </div>
        <Separator />
      </SidebarHeader>
      <SidebarContent className="relative overflow-hidden">
        {/* Main nav panel */}
        <div
          className={cn(
            "absolute inset-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
            isSettingsMode ? "-translate-x-full opacity-0" : "translate-x-0 opacity-100",
          )}
        >
          <SidebarGroup>
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
        </div>

        {/* Settings nav panel */}
        <div
          className={cn(
            "absolute inset-0 overflow-y-auto transition-transform duration-200 ease-out motion-reduce:transition-none",
            isSettingsMode ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
          )}
        >
          {settingsNavGroups.map((group) => {
            const visibleGroupItems = group.items.filter((item) => {
              if (item.requiredSuperAdmin) return isSuperAdmin;
              return isSuperAdmin || userRole === "ADMIN";
            });
            if (visibleGroupItems.length === 0) return null;
            return (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleGroupItems.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                          tooltip={item.title}
                        >
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </div>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleSidebar} tooltip={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {isCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
              <span>Collapse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
