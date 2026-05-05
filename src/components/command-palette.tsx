// src/components/command-palette.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  FileText,
  LayoutDashboard,
  Layers,
  Play,
  Rocket,
  ScrollText,
  Search,
  Server,
  Settings,
  Workflow,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { useEnvironmentStore } from "@/stores/environment-store";

interface NavPage {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  shortcut?: string;
}

const NAV_PAGES: NavPage[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard, keywords: ["home", "overview"], shortcut: "g d" },
  { title: "Pipelines", href: "/pipelines", icon: Workflow, keywords: ["pipeline", "list"], shortcut: "g p" },
  { title: "Fleet", href: "/fleet", icon: Server, keywords: ["nodes", "agents"], shortcut: "g f" },
  { title: "Environments", href: "/environments", icon: Layers, keywords: ["env", "staging", "production"] },
  { title: "Library", href: "/library", icon: FileText, keywords: ["templates", "shared"] },
  { title: "Audit Log", href: "/audit", icon: ScrollText, keywords: ["history", "changes"] },
  { title: "Deployments", href: "/audit/deployments", icon: Rocket, keywords: ["deploy", "releases"] },
  { title: "Alerts", href: "/alerts", icon: Bell, keywords: ["notifications", "warnings"], shortcut: "g a" },
  { title: "Incidents", href: "/incidents", icon: Bell, keywords: ["timeline", "anomalies"], shortcut: "g i" },
  { title: "Analytics", href: "/analytics", icon: BarChart3, keywords: ["metrics", "charts", "cost"] },
  { title: "Settings", href: "/settings", icon: Settings, keywords: ["config", "preferences"], shortcut: "g s" },
  { title: "Authentication", href: "/settings/auth", icon: Settings, keywords: ["login", "sso", "oidc"] },
  { title: "Users", href: "/settings/users", icon: Settings, keywords: ["members", "accounts"] },
  { title: "Roles", href: "/settings/roles", icon: Settings, keywords: ["permissions", "matrix"] },
  { title: "My Team", href: "/settings/team", icon: Settings, keywords: ["team config"] },
  { title: "Service Accounts", href: "/settings/service-accounts", icon: Settings, keywords: ["api keys", "tokens"] },
  { title: "Secrets", href: "/settings/secrets", icon: Settings, keywords: ["vault", "security"] },
];

let openCommandPalette: (() => void) | null = null;

export function triggerCommandPalette() {
  openCommandPalette?.();
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  useEffect(() => {
    openCommandPalette = () => setOpen(true);
    return () => {
      openCommandPalette = null;
    };
  }, []);

  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) setSearch("");
  }, []);

  const shouldFetch = open && search.length >= 2;

  const pipelinesQuery = useQuery(
    trpc.pipeline.list.queryOptions(
      { environmentId: selectedEnvironmentId ?? "", search, limit: 8 },
      { enabled: shouldFetch && !!selectedEnvironmentId },
    ),
  );
  const pipelines = useMemo(() => pipelinesQuery.data?.pipelines ?? [], [pipelinesQuery.data]);

  const nodesQuery = useQuery(
    trpc.fleet.list.queryOptions(
      { environmentId: selectedEnvironmentId ?? "", search },
      { enabled: shouldFetch && !!selectedEnvironmentId },
    ),
  );
  const nodes = useMemo(() => (nodesQuery.data ?? []).slice(0, 8), [nodesQuery.data]);

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
    return allEnvs.filter((env) => env.name.toLowerCase().includes(lower)).slice(0, 5);
  }, [environmentsQuery.data, search]);

  const navigateTo = useCallback(
    (href: string) => {
      setOpen(false);
      setSearch("");
      router.push(href);
    },
    [router],
  );

  const resultCount = pipelines.length + nodes.length + environments.length + NAV_PAGES.length;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Search pipelines, nodes, environments, and pages..."
      className="border-line bg-bg-2 text-fg sm:max-w-2xl"
    >
      <CommandInput
        placeholder="Search pipelines, nodes, pages..."
        value={search}
        onValueChange={setSearch}
        className="font-mono text-[13px]"
      />
      <CommandList className="max-h-[520px]">
        <CommandEmpty className="py-8 font-mono text-[12px] text-fg-2">
          {search.length < 2 ? "Type to search..." : "No results found."}
        </CommandEmpty>

        {pipelines.length > 0 && (
          <CommandSection heading="Pipelines">
            {pipelines.map((pipeline) => (
              <PaletteItem
                key={pipeline.id}
                icon={Workflow}
                title={pipeline.name}
                subtitle={pipeline.isDraft ? "draft pipeline" : "pipeline"}
                value={`pipeline:${pipeline.name}`}
                onSelect={() => navigateTo(`/pipelines/${pipeline.id}`)}
              />
            ))}
          </CommandSection>
        )}

        {nodes.length > 0 && (
          <CommandSection heading="Fleet nodes" separated>
            {nodes.map((node) => (
              <PaletteItem
                key={node.id}
                icon={Server}
                title={node.name}
                subtitle={node.host}
                value={`node:${node.name}:${node.host}`}
                onSelect={() => navigateTo(`/fleet/${node.id}`)}
              />
            ))}
          </CommandSection>
        )}

        {environments.length > 0 && (
          <CommandSection heading="Environments" separated>
            {environments.map((env) => (
              <PaletteItem
                key={env.id}
                icon={Layers}
                title={env.name}
                subtitle={`${env._count.pipelines} pipelines`}
                value={`env:${env.name}`}
                onSelect={() => navigateTo(`/environments/${env.id}`)}
              />
            ))}
          </CommandSection>
        )}

        <CommandSection heading="Pages" separated>
          {NAV_PAGES.map((page) => (
            <PaletteItem
              key={page.href}
              icon={page.icon}
              title={page.title}
              subtitle={page.keywords?.slice(0, 2).join(" · ") ?? page.href}
              shortcut={page.shortcut}
              value={`page:${page.title}:${page.keywords?.join(" ") ?? ""}`}
              onSelect={() => navigateTo(page.href)}
            />
          ))}
        </CommandSection>

        {selectedEnvironmentId && pipelines.length > 0 && (
          <CommandSection heading="Quick actions" separated>
            {pipelines.slice(0, 3).map((pipeline) => (
              <PaletteItem
                key={`deploy:${pipeline.id}`}
                icon={Play}
                title={`Open ${pipeline.name}`}
                subtitle="pipeline detail"
                value={`action:deploy:${pipeline.name}`}
                onSelect={() => navigateTo(`/pipelines/${pipeline.id}`)}
              />
            ))}
          </CommandSection>
        )}
      </CommandList>
      <div className="flex items-center justify-between border-t border-line bg-bg-1 px-4 py-2 font-mono text-[10.5px] text-fg-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Kbd>↑↓</Kbd> navigate</span>
          <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="inline-flex items-center gap-1"><Kbd>⌘K</Kbd> toggle</span>
        </div>
        <span>{resultCount} indexed actions</span>
      </div>
    </CommandDialog>
  );
}

function CommandSection({ heading, separated = false, children }: { heading: string; separated?: boolean; children: React.ReactNode }) {
  return (
    <>
      {separated && <CommandSeparator className="bg-line" />}
      <CommandGroup heading={heading} className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-fg-2">
        {children}
      </CommandGroup>
    </>
  );
}

function PaletteItem({
  icon: Icon,
  title,
  subtitle,
  shortcut,
  value,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  shortcut?: string;
  value: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      className="border-l-2 border-transparent px-3 py-2.5 text-[12px] data-[selected=true]:border-accent-brand data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg"
    >
      <Icon className="h-3.5 w-3.5 text-fg-2" />
      <span className="font-medium text-fg">{title}</span>
      <span className="ml-auto font-mono text-[11px] text-fg-2">{subtitle}</span>
      <CommandShortcut className="ml-2 hidden sm:inline-flex">
        {shortcut ? <Kbd>{shortcut}</Kbd> : <Search className="h-3 w-3" />}
      </CommandShortcut>
    </CommandItem>
  );
}
