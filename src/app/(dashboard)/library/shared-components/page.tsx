"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Link2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
/*  Kind badge styling                                                 */
/* ------------------------------------------------------------------ */

const kindVariant: Record<string, string> = {
  SOURCE:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  TRANSFORM:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  SINK: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

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
    <div className="space-y-8">
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
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
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
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Linked Pipelines</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((sc) => (
                <TableRow
                  key={sc.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/library/shared-components/${sc.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      {sc.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sc.componentType}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={kindVariant[sc.kind] ?? ""}>
                      {sc.kind}
                    </Badge>
                  </TableCell>
                  <TableCell>{sc.linkedPipelineCount}</TableCell>
                  <TableCell>v{sc.version}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(sc.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
