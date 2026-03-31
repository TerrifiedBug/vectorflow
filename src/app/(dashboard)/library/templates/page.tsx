"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { cn, generateId } from "@/lib/utils";
import { useTeamStore } from "@/stores/team-store";
import {
  FileText,
  Trash2,
  ArrowRight,
  Database,
  Cloud,
  Radio,
  Cpu,
  Terminal,
  Play,
  Shield,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

/* ------------------------------------------------------------------ */
/*  Category definitions                                               */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  { id: "Getting Started", icon: <Play className="h-3.5 w-3.5" />, color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  { id: "Logging", icon: <FileText className="h-3.5 w-3.5" />, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  { id: "Archival", icon: <Cloud className="h-3.5 w-3.5" />, color: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
  { id: "Streaming", icon: <Radio className="h-3.5 w-3.5" />, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
  { id: "Metrics", icon: <Cpu className="h-3.5 w-3.5" />, color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300" },
  { id: "Data Protection", icon: <Shield className="h-3.5 w-3.5" />, color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
] as const;

const categoryIcons: Record<string, React.ReactNode> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.icon]),
);

const categoryColors: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.color]),
);

const complianceTagColors: Record<string, string> = {
  "PCI-DSS": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  HIPAA: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  GDPR: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
};

/* ------------------------------------------------------------------ */
/*  Compliance tag helper                                              */
/* ------------------------------------------------------------------ */

function getComplianceTags(nodes: unknown[] | undefined): string[] {
  if (!Array.isArray(nodes)) return [];
  for (const node of nodes as Array<{ metadata?: { complianceTags?: string[] } }>) {
    if (node.metadata?.complianceTags?.length) {
      return node.metadata.complianceTags;
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function TemplatesPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  // Fetch templates for the selected team
  const templatesQuery = useQuery(
    trpc.template.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);

  // --- Filter state ---
  const [search, setSearch] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(localSearch), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch]);

  const toggleCategory = (id: string) => {
    setCategoryFilter((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const hasActiveFilters = search.length > 0 || categoryFilter.length > 0;

  const clearFilters = () => {
    setSearch("");
    setLocalSearch("");
    setCategoryFilter([]);
  };

  // Derive categories that actually exist in the template data
  const availableCategories = useMemo(() => {
    const cats = new Set(templates.map((t) => t.category));
    return CATEGORIES.filter((c) => cats.has(c.id));
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const q = search.toLowerCase();
    return templates.filter((t) => {
      if (categoryFilter.length > 0 && !categoryFilter.includes(t.category)) return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, search, categoryFilter]);

  // Create pipeline from template
  const createPipelineMutation = useMutation(
    trpc.pipeline.create.mutationOptions({
      onSuccess: async (pipeline) => {
        // Now load the template graph into the new pipeline
        return pipeline;
      },
    }),
  );

  const saveGraphMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({
      onSuccess: (pipeline) => {
        router.push(`/pipelines/${pipeline.id}`);
      },
    }),
  );

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const deleteTemplateMutation = useMutation(
    trpc.template.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.template.list.queryKey() });
        setDeleteConfirm(null);
      },
    }),
  );

  const handleUseTemplate = async (templateId: string) => {
    if (!selectedEnvironmentId) return;

    // Get the full template data
    const template = await queryClient.fetchQuery(
      trpc.template.get.queryOptions({ id: templateId }),
    );

    // Create a new pipeline
    const pipeline = await createPipelineMutation.mutateAsync({
      name: `${template.name} Pipeline`,
      description: `Created from template: ${template.description}`,
      environmentId: selectedEnvironmentId,
    });

    // Map template nodes to pipeline nodes
    const templateNodes = template.nodes as Array<{
      id: string;
      componentType: string;
      componentKey: string;
      kind: string;
      config: Record<string, unknown>;
      positionX: number;
      positionY: number;
    }>;

    const templateEdges = template.edges as Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      sourcePort?: string;
    }>;

    // Generate new IDs for nodes and update edge references
    const idMap = new Map<string, string>();
    const pipelineNodes = templateNodes.map((n) => {
      const newId = generateId();
      idMap.set(n.id, newId);
      return {
        id: newId,
        componentKey: n.componentKey,
        componentType: n.componentType,
        kind: n.kind.toUpperCase() as "SOURCE" | "TRANSFORM" | "SINK",
        config: n.config,
        positionX: n.positionX,
        positionY: n.positionY,
      };
    });

    const pipelineEdges = templateEdges.map((e) => ({
      id: generateId(),
      sourceNodeId: idMap.get(e.sourceNodeId) ?? e.sourceNodeId,
      targetNodeId: idMap.get(e.targetNodeId) ?? e.targetNodeId,
      sourcePort: e.sourcePort,
    }));

    await saveGraphMutation.mutateAsync({
      pipelineId: pipeline.id,
      nodes: pipelineNodes,
      edges: pipelineEdges,
    });
  };

  const isLoading = templatesQuery.isLoading;
  const isCreating =
    createPipelineMutation.isPending || saveGraphMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Environment notice */}
      {!selectedEnvironmentId && (
        <EmptyState title="Select an environment from the header to use templates" className="p-4 text-sm" />
      )}

      {templatesQuery.isError ? (
        <QueryError message="Failed to load templates" onRetry={() => templatesQuery.refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState icon={Terminal} title="No templates yet. Save a pipeline as a template to get started." />
      ) : (
        <section className="space-y-4">
          {/* Filter toolbar */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
            {/* Search */}
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search templates..."
                className="h-8 pl-8 text-sm"
              />
            </div>

            {/* Separator */}
            {availableCategories.length > 0 && <div className="h-6 w-px bg-border" />}

            {/* Category chips */}
            <div className="flex items-center gap-1">
              {availableCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-xs font-medium border transition-colors",
                    categoryFilter.includes(cat.id)
                      ? cat.color + " border-transparent"
                      : "bg-transparent text-muted-foreground border-border hover:bg-muted",
                  )}
                >
                  {cat.icon}
                  {cat.id}
                </button>
              ))}
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={clearFilters}
              >
                <X className="mr-1 h-3 w-3" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Results count when filtered */}
          {hasActiveFilters && (
            <p className="text-xs text-muted-foreground">
              {filteredTemplates.length} of {templates.length} templates
            </p>
          )}

          {filteredTemplates.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No templates match your filters"
              description="Try adjusting your search or category filters."
            />
          ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((template) => (
              <Card key={template.id} className="cursor-pointer flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      {template.name}
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={categoryColors[template.category] ?? ""}
                    >
                      {categoryIcons[template.category] ?? null}
                      <span className={categoryIcons[template.category] ? "ml-1" : ""}>
                        {template.category}
                      </span>
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    {template.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 pb-3">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      {template.nodeCount} nodes
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" />
                      {template.edgeCount} edges
                    </span>
                  </div>
                  {(() => {
                    const tags = getComplianceTags(template.nodes);
                    if (tags.length === 0) return null;
                    return (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className={`px-1.5 py-0 text-[10px] ${complianceTagColors[tag] ?? ""}`}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
                <CardFooter className="flex gap-2 pt-0">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={!selectedEnvironmentId || isCreating}
                    onClick={() => handleUseTemplate(template.id)}
                  >
                    {isCreating ? "Creating..." : "Use Template"}
                  </Button>
                  {template.teamId !== null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm({ id: template.id, name: template.name })}
                      disabled={deleteTemplateMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
          )}
        </section>
      )}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Delete template?"
        description={<>Permanently delete <span className="font-medium">{deleteConfirm?.name}</span>? This action cannot be undone.</>}
        confirmLabel="Delete"
        isPending={deleteTemplateMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (!deleteConfirm) return;
          deleteTemplateMutation.mutate({ id: deleteConfirm.id });
        }}
      />
    </div>
  );
}
