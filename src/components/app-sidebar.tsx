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
  Users,
} from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { TeamSelector } from "@/components/team-selector";
import { EnvironmentSelector } from "@/components/environment-selector";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTeamStore } from "@/stores/team-store";
import { useEnvironmentStore } from "@/stores/environment-store";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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
  { title: "Templates", href: "/templates", icon: FileText },
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

  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-0 group-data-[collapsible=icon]:p-0">
        {/* Logo row — matches the h-14 main content header for border alignment */}
        <div className="flex h-14 items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl tracking-tight group-data-[collapsible=icon]:hidden">
              <span className="font-bold">Vector</span>
              <span className="font-light">Flow</span>
            </span>
            <span className="hidden text-xl group-data-[collapsible=icon]:block"><span className="font-bold">V</span><span className="font-light">f</span></span>
          </Link>
        </div>
        <Separator />
        {/* Context selectors */}
        <div className="space-y-1.5 p-3 group-data-[collapsible=icon]:hidden">
          <TeamSelector />
          <EnvironmentSelector />
        </div>
        {/* Collapsed mode: icon buttons with popovers */}
        <div className="hidden group-data-[collapsible=icon]:flex flex-col items-center gap-1 py-2">
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Select team">
                    <Users className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">Team</TooltipContent>
            </Tooltip>
            <PopoverContent side="right" align="start" className="w-56 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Team</p>
              <TeamSelector />
            </PopoverContent>
          </Popover>
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Select environment">
                    <Layers className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">Environment</TooltipContent>
            </Tooltip>
            <PopoverContent side="right" align="start" className="w-56 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Environment</p>
              <EnvironmentSelector />
            </PopoverContent>
          </Popover>
        </div>
      </SidebarHeader>
      <SidebarContent>
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
