// src/components/command-palette.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Workflow,
  Server,
  Layers,
  Settings,
  LayoutDashboard,
  Bell,
  ScrollText,
  BarChart3,
  FileText,
  Rocket,
  Play,
  Search,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { useEnvironmentStore } from "@/stores/environment-store";

// ─── Static navigation pages ───────────────────────────────────────────────

interface NavPage {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
}

const NAV_PAGES: NavPage[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard, keywords: ["home", "overview"] },
  { title: "Pipelines", href: "/pipelines", icon: Workflow, keywords: ["pipeline", "list"] },
  { title: "Fleet", href: "/fleet", icon: Server, keywords: ["nodes", "agents"] },
  { title: "Environments", href: "/environments", icon: Layers, keywords: ["env", "staging", "production"] },
  { title: "Library", href: "/library", icon: FileText, keywords: ["templates", "shared"] },
  { title: "Audit Log", href: "/audit", icon: ScrollText, keywords: ["history", "changes"] },
  { title: "Deployments", href: "/audit/deployments", icon: Rocket, keywords: ["deploy", "releases"] },
  { title: "Alerts", href: "/alerts", icon: Bell, keywords: ["notifications", "warnings"] },
  { title: "Analytics", href: "/analytics", icon: BarChart3, keywords: ["metrics", "charts", "cost"] },
  { title: "Settings", href: "/settings", icon: Settings, keywords: ["config", "preferences"] },
  { title: "Authentication", href: "/settings/auth", icon: Settings, keywords: ["login", "sso", "oidc"] },
  { title: "Users", href: "/settings/users", icon: Settings, keywords: ["members", "accounts"] },
  { title: "Teams", href: "/settings/teams", icon: Settings, keywords: ["organization"] },
  { title: "Team Settings", href: "/settings/team", icon: Settings, keywords: ["team config"] },
  { title: "Service Accounts", href: "/settings/service-accounts", icon: Settings, keywords: ["api keys", "tokens"] },
  { title: "Outbound Webhooks", href: "/settings/webhooks", icon: Settings, keywords: ["hooks", "integrations"] },
  { title: "Backup", href: "/settings/backup", icon: Settings, keywords: ["restore", "export"] },
  { title: "Fleet Settings", href: "/settings/fleet", icon: Settings, keywords: ["agent config"] },
  { title: "AI", href: "/settings/ai", icon: Settings, keywords: ["assistant", "copilot"] },
];

// ─── Component ─────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Reset search when dialog closes
  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) setSearch("");
  }, []);

  // Only fetch when dialog is open and there is a search query
  const shouldFetch = open && search.length >= 2;

  // ── Pipelines search ──
  const pipelinesQuery = useQuery(
    trpc.pipeline.list.queryOptions(
      {
        environmentId: selectedEnvironmentId ?? "",
        search,
        limit: 8,
      },
      { enabled: shouldFetch && !!selectedEnvironmentId },
    ),
  );
  const pipelines = useMemo(
    () => pipelinesQuery.data?.pipelines ?? [],
    [pipelinesQuery.data],
  );

  // ── Fleet nodes search ──
  const nodesQuery = useQuery(
    trpc.fleet.list.queryOptions(
      {
        environmentId: selectedEnvironmentId ?? "",
        search,
      },
      { enabled: shouldFetch && !!selectedEnvironmentId },
    ),
  );
  const nodes = useMemo(() => {
    const allNodes = nodesQuery.data ?? [];
    return allNodes.slice(0, 8);
  }, [nodesQuery.data]);

  // ── Environments search ──
  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId ?? "" },
      { enabled: open && !!selectedTeamId },
    ),
  );
  const environments = useMemo(() => {
    const allEnvs = environmentsQuery.data ?? [];
    if (!search) return allEnvs.slice(0, 5);
    const lower = search.toLowerCase();
    return allEnvs
      .filter((e) => e.name.toLowerCase().includes(lower))
      .slice(0, 5);
  }, [environmentsQuery.data, search]);

  // ── Navigation helpers ──
  const navigateTo = useCallback(
    (href: string) => {
      setOpen(false);
      setSearch("");
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Search pipelines, nodes, environments, and pages..."
    >
      <CommandInput
        placeholder="Search pipelines, nodes, pages..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {search.length < 2 ? "Type to search..." : "No results found."}
        </CommandEmpty>

        {/* ── Pipelines ── */}
        {pipelines.length > 0 && (
          <CommandGroup heading="Pipelines">
            {pipelines.map((p) => (
              <CommandItem
                key={p.id}
                value={`pipeline:${p.name}`}
                onSelect={() => navigateTo(`/pipelines/${p.id}`)}
              >
                <Workflow className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{p.name}</span>
                {p.isDraft && (
                  <span className="ml-2 text-xs text-muted-foreground">Draft</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* ── Fleet Nodes ── */}
        {nodes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Fleet Nodes">
              {nodes.map((n) => (
                <CommandItem
                  key={n.id}
                  value={`node:${n.name}:${n.host}`}
                  onSelect={() => navigateTo(`/fleet/${n.id}`)}
                >
                  <Server className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{n.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{n.host}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* ── Environments ── */}
        {environments.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Environments">
              {environments.map((e) => (
                <CommandItem
                  key={e.id}
                  value={`env:${e.name}`}
                  onSelect={() => navigateTo(`/environments/${e.id}`)}
                >
                  <Layers className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{e.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                    {e._count.pipelines} pipelines
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* ── Pages ── */}
        <CommandSeparator />
        <CommandGroup heading="Pages">
          {NAV_PAGES.map((page) => (
            <CommandItem
              key={page.href}
              value={`page:${page.title}:${page.keywords?.join(" ") ?? ""}`}
              onSelect={() => navigateTo(page.href)}
            >
              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{page.title}</span>
              <CommandShortcut className="hidden sm:inline-flex">
                <Search className="h-3 w-3" />
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* ── Quick Actions ── */}
        {selectedEnvironmentId && pipelines.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Quick Actions">
              {pipelines.slice(0, 3).map((p) => (
                <CommandItem
                  key={`deploy:${p.id}`}
                  value={`action:deploy:${p.name}`}
                  onSelect={() => navigateTo(`/pipelines/${p.id}`)}
                >
                  <Play className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>Go to &quot;{p.name}&quot;</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
