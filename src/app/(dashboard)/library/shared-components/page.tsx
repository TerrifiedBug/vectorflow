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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { NODE_KIND_META } from "@/lib/node-kind-colors";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

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

// Library uses Prisma's UPPER-CASE enum; pipeline editor uses lowercase. Bridge
// to the shared NODE_KIND_META so both surfaces use the same node colors.
const kindConfig: Record<string, { label: string; badge: string; accent: string; border: string }> = {
  SOURCE: {
    label: NODE_KIND_META.source.pluralLabel,
    badge: cn(NODE_KIND_META.source.bgClass, NODE_KIND_META.source.fgClass),
    accent: NODE_KIND_META.source.accentClass,
    border: NODE_KIND_META.source.borderClass,
  },
  TRANSFORM: {
    label: NODE_KIND_META.transform.pluralLabel,
    badge: cn(NODE_KIND_META.transform.bgClass, NODE_KIND_META.transform.fgClass),
    accent: NODE_KIND_META.transform.accentClass,
    border: NODE_KIND_META.transform.borderClass,
  },
  SINK: {
    label: NODE_KIND_META.sink.pluralLabel,
    badge: cn(NODE_KIND_META.sink.bgClass, NODE_KIND_META.sink.fgClass),
    accent: NODE_KIND_META.sink.accentClass,
    border: NODE_KIND_META.sink.borderClass,
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
      <div className="space-y-6">
        <EmptyState title="Select an environment from the header to view shared components" className="p-4 text-sm" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => router.push("/library/shared-components/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Shared Component
        </Button>
      </div>

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

      {componentsQuery.isError ? (
        <QueryError message="Failed to load shared components" onRetry={() => componentsQuery.refetch()} />
      ) : componentsQuery.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Link2} title={components.length === 0 ? "No shared components yet. Create one to get started." : "No components match your search."} />
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
                borderClass={group.border}
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
  borderClass,
  items,
  onItemClick,
}: {
  label: string;
  count: number;
  accent: string;
  badgeClass: string;
  borderClass: string;
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
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((sc) => (
            <Card
              key={sc.id}
              className={cn(
                "cursor-pointer border-l-[3px] transition-colors hover:bg-accent/50",
                borderClass,
              )}
              onClick={() => onItemClick(sc.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{sc.name}</CardTitle>
                  <Badge variant="outline" className={cn("text-xs", badgeClass)}>
                    v{sc.version}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{sc.componentType}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Link2 className="h-3 w-3" />
                  <span>{sc.linkedPipelineCount} linked</span>
                  <span className="ml-auto">{formatRelativeTime(sc.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
