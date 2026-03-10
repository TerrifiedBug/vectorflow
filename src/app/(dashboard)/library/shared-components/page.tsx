"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { ChevronDown, Link2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Kind styling                                                       */
/* ------------------------------------------------------------------ */

const kindConfig: Record<string, { label: string; badge: string; accent: string }> = {
  SOURCE: {
    label: "Sources",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  TRANSFORM: {
    label: "Transforms",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
    accent: "text-sky-600 dark:text-sky-400",
  },
  SINK: {
    label: "Sinks",
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    accent: "text-orange-600 dark:text-orange-400",
  },
};

const KIND_ORDER = ["SOURCE", "TRANSFORM", "SINK"] as const;

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function SharedComponentsPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );
  const [search, setSearch] = useState("");

  const componentsQuery = useQuery(
    trpc.sharedComponent.list.queryOptions(
      { environmentId: selectedEnvironmentId! },
      { enabled: !!selectedEnvironmentId },
    ),
  );

  const components = componentsQuery.data ?? [];

  const filtered = components.filter((sc) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      sc.name.toLowerCase().includes(q) ||
      sc.componentType.toLowerCase().includes(q)
    );
  });

  // Group by kind
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    ...kindConfig[kind],
    items: filtered.filter((sc) => sc.kind === kind),
  }));

  if (!selectedEnvironmentId) {
    return (
      <div className="space-y-8">
        <PageHeader title="Shared Components" />
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Select an environment from the header to view shared components
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shared Components"
        actions={
          <Button onClick={() => router.push("/library/shared-components/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Shared Component
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or type..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {componentsQuery.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Link2 className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            {components.length === 0
              ? "No shared components yet. Create one to get started."
              : "No components match your search."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => {
            if (group.items.length === 0) return null;
            return (
              <KindSection
                key={group.kind}
                label={group.label}
                count={group.items.length}
                accent={group.accent}
                badgeClass={group.badge}
                items={group.items}
                onItemClick={(id) => router.push(`/library/shared-components/${id}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Kind Section (collapsible)                                         */
/* ------------------------------------------------------------------ */

interface SharedComponentItem {
  id: string;
  name: string;
  componentType: string;
  kind: string;
  version: number;
  linkedPipelineCount: number;
  updatedAt: Date | string | null;
}

function KindSection({
  label,
  count,
  accent,
  badgeClass,
  items,
  onItemClick,
}: {
  label: string;
  count: number;
  accent: string;
  badgeClass: string;
  items: SharedComponentItem[];
  onItemClick: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            !open && "-rotate-90",
          )}
        />
        <span className={cn("text-sm font-semibold", accent)}>{label}</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {count}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 divide-y rounded-lg border">
          {items.map((sc) => (
            <button
              key={sc.id}
              onClick={() => onItemClick(sc.id)}
              className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{sc.name}</p>
                <p className="text-xs text-muted-foreground">{sc.componentType}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                <span>{sc.linkedPipelineCount} linked</span>
                <Badge variant="outline" className={cn("text-xs", badgeClass)}>
                  v{sc.version}
                </Badge>
                <span className="w-16 text-right">{formatRelativeTime(sc.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
