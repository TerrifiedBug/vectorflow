"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { libraryNavItems } from "@/components/library-sidebar-nav";
import { usePipelineSidebarStore } from "@/stores/pipeline-sidebar-store";
import { PipelineGroupTree } from "@/components/pipeline/pipeline-group-tree";
import { Button } from "@/components/ui/button";

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

const observeItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Pipelines", href: "/pipelines", icon: Workflow },
  { title: "Fleet", href: "/fleet", icon: Server },
];

const operateItems = [
  { title: "Alerts", href: "/alerts", icon: Bell },
  { title: "Analytics", href: "/analytics", icon: BarChart3 },
  { title: "Audit Log", href: "/audit", icon: ScrollText },
];

const configureItems = [
  { title: "Environments", href: "/environments", icon: Layers },
  { title: "Library", href: "/library", icon: FileText },
  { title: "Settings", href: "/settings", icon: Settings, requiredRole: "ADMIN" as const },
];

type NavItem = (typeof observeItems)[number] & { requiredRole?: "ADMIN" };

const navGroups: { label: string; items: NavItem[] }[] = [
  { label: "Observe", items: observeItems },
  { label: "Operate", items: operateItems },
  { label: "Configure", items: configureItems },
];

/** Nav items visible when the system environment is selected */
const SYSTEM_ENV_ALLOWED_HREFS = new Set(["/", "/pipelines"]);

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
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

  const filterItem = (item: NavItem): boolean => {
    if (isSystemEnvironment && !SYSTEM_ENV_ALLOWED_HREFS.has(item.href)) {
      return false;
    }
    if (!item.requiredRole) return true;
    if (isSuperAdmin) return true;
    if (!userRole) return false;
    const roleLevel: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };
    return (roleLevel[userRole] ?? 0) >= (roleLevel[item.requiredRole] ?? 0);
  };

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(filterItem),
    }))
    .filter((group) => group.items.length > 0);

  const isSettingsMode = pathname.startsWith("/settings");
  const isLibraryMode = pathname.startsWith("/library");
  const isPipelinesMode = pathname.startsWith("/pipelines");
  const isSubMode = isSettingsMode || isLibraryMode || isPipelinesMode;

  const handleBack = () => {
    router.push("/");
  };

  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  // Pipelines panel state
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);
  const { selectedGroupId, setSelectedGroupId, expandedGroupIds, toggleExpandedGroup, setManageGroupsOpen } = usePipelineSidebarStore();

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const environments = environmentsQuery.data ?? [];
  const effectiveEnvId = selectedEnvironmentId || environments[0]?.id || "";

  return (
    <Sidebar collapsible="icon" aria-label="Main navigation">
      <SidebarHeader className="p-0">
        <div className="flex h-14 items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
          {isSubMode ? (
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="group-data-[collapsible=icon]:hidden">
                {isSettingsMode ? "Settings" : isLibraryMode ? "Library" : "Pipelines"}
              </span>
            </button>
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
            isSubMode && !isCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100",
          )}
          aria-hidden={isSubMode && !isCollapsed}
        >
          {visibleGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const matchesPath =
                      item.href === "/"
                        ? pathname === "/"
                        : pathname === item.href || pathname.startsWith(item.href + "/");
                    const allItems = visibleGroups.flatMap((g) => g.items);
                    const moreSpecificMatch = matchesPath && allItems.some(
                      (other) =>
                        other.href !== item.href &&
                        other.href.startsWith(item.href + "/") &&
                        (pathname === other.href || pathname.startsWith(other.href + "/"))
                    );
                    const isActive = matchesPath && !moreSpecificMatch;

                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          className="data-[active=true]:font-semibold data-[active=true]:border-l-2 data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent/60"
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
          ))}
        </div>

        {/* Settings nav panel */}
        <div
          className={cn(
            "absolute inset-0 overflow-y-auto transition-transform duration-200 ease-out motion-reduce:transition-none",
            isSettingsMode && !isCollapsed ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none",
          )}
          aria-hidden={!isSettingsMode || isCollapsed}
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
                          className="data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:font-medium data-[active=true]:border-l-2 data-[active=true]:border-primary"
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

        {/* Library nav panel */}
        <div
          className={cn(
            "absolute inset-0 overflow-y-auto transition-transform duration-200 ease-out motion-reduce:transition-none",
            isLibraryMode && !isCollapsed ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none",
          )}
          aria-hidden={!isLibraryMode || isCollapsed}
        >
          <SidebarGroup>
            <SidebarGroupLabel>Browse</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {libraryNavItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                      tooltip={item.title}
                      className="data-[active=true]:font-semibold data-[active=true]:border-l-2 data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent/60"
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
        </div>

        {/* Pipelines nav panel */}
        <div
          className={cn(
            "absolute inset-0 overflow-y-auto transition-transform duration-200 ease-out motion-reduce:transition-none",
            isPipelinesMode && !isCollapsed ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none",
          )}
          aria-hidden={!isPipelinesMode || isCollapsed}
        >
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between">
              <span>Folders</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto py-0 px-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setManageGroupsOpen(true)}
              >
                Manage
              </Button>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {!effectiveEnvId ? (
                <div className="px-2 py-4 text-xs text-muted-foreground">
                  Select an environment
                </div>
              ) : (
                <PipelineGroupTree
                  environmentId={effectiveEnvId}
                  selectedGroupId={selectedGroupId}
                  onSelectGroup={setSelectedGroupId}
                  expandedGroupIds={expandedGroupIds}
                  onToggleExpand={toggleExpandedGroup}
                />
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
              <span>Collapse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
