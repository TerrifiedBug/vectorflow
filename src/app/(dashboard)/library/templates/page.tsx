"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Cloud,
  Cpu,
  Database,
  FileText,
  Package,
  Play,
  Radio,
  Search,
  Shield,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { cn, generateId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { PageHeader } from "@/components/ui/page-header";

const CATEGORIES = [
  { id: "Getting Started", icon: Play, color: "text-status-ok" },
  { id: "Logging", icon: FileText, color: "text-accent-brand" },
  { id: "Archival", icon: Cloud, color: "text-chart-3" },
  { id: "Streaming", icon: Radio, color: "text-status-degraded" },
  { id: "Metrics", icon: Cpu, color: "text-chart-4" },
  { id: "Data Protection", icon: Shield, color: "text-status-error" },
] as const;

const categoryIcons = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon]));
const categoryColors = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.color]));

const complianceTagColors: Record<string, string> = {
  "PCI-DSS": "border-status-degraded/40 bg-status-degraded-bg text-status-degraded",
  HIPAA: "border-accent-line bg-accent-soft text-accent-brand",
  GDPR: "border-status-ok/40 bg-status-ok-bg text-status-ok",
};

type TemplateNode = {
  id: string;
  componentType: string;
  componentKey: string;
  kind: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
  metadata?: { complianceTags?: string[] };
};

type TemplateEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
};

function getComplianceTags(nodes: unknown[] | undefined): string[] {
  if (!Array.isArray(nodes)) return [];
  for (const node of nodes as TemplateNode[]) {
    if (node.metadata?.complianceTags?.length) return node.metadata.complianceTags;
  }
  return [];
}

/**
 * v2 templates gallery (D): dense cards, mono filter chips, detail-route CTA, create-from-template flow preserved.
 */
export default function TemplatesPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const templatesQuery = useQuery(
    trpc.template.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const packsQuery = useQuery(trpc.pack.list.queryOptions());
  const featuredPacks = useMemo(
    () => (packsQuery.data ?? []).filter((pack) => pack.featured),
    [packsQuery.data],
  );

  const [search, setSearch] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(localSearch), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch]);

  const availableCategories = useMemo(() => {
    const cats = new Set(templates.map((template) => template.category));
    return CATEGORIES.filter((category) => cats.has(category.id));
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const query = search.toLowerCase();
    return templates.filter((template) => {
      if (categoryFilter.length > 0 && !categoryFilter.includes(template.category)) return false;
      if (
        query &&
        !template.name.toLowerCase().includes(query) &&
        !template.description.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [templates, search, categoryFilter]);

  const templateStats = useMemo(() => {
    const nodeCount = templates.reduce((sum, template) => sum + template.nodeCount, 0);
    const edgeCount = templates.reduce((sum, template) => sum + template.edgeCount, 0);
    return { nodeCount, edgeCount, customCount: templates.filter((template) => template.teamId !== null).length };
  }, [templates]);

  const createPipelineMutation = useMutation(trpc.pipeline.create.mutationOptions());
  const saveGraphMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({
      onSuccess: (pipeline) => router.push(`/pipelines/${pipeline.id}/edit`),
    }),
  );
  const deleteTemplateMutation = useMutation(
    trpc.template.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.template.list.queryKey() });
        setDeleteConfirm(null);
      },
    }),
  );

  async function handleUseTemplate(templateId: string) {
    if (!selectedEnvironmentId) return;
    const template = await queryClient.fetchQuery(trpc.template.get.queryOptions({ id: templateId }));
    const pipeline = await createPipelineMutation.mutateAsync({
      name: `${template.name} Pipeline`,
      description: `Created from template: ${template.description}`,
      environmentId: selectedEnvironmentId,
    });

    const templateNodes = template.nodes as TemplateNode[];
    const templateEdges = template.edges as TemplateEdge[];
    const idMap = new Map<string, string>();
    const pipelineNodes = templateNodes.map((node) => {
      const id = generateId();
      idMap.set(node.id, id);
      return {
        id,
        componentKey: node.componentKey,
        componentType: node.componentType,
        kind: node.kind.toUpperCase() as "SOURCE" | "TRANSFORM" | "SINK",
        config: node.config,
        positionX: node.positionX,
        positionY: node.positionY,
      };
    });
    const pipelineEdges = templateEdges.map((edge) => ({
      id: generateId(),
      sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
      targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId,
      sourcePort: edge.sourcePort,
    }));

    await saveGraphMutation.mutateAsync({ pipelineId: pipeline.id, nodes: pipelineNodes, edges: pipelineEdges });
  }

  function toggleCategory(id: string) {
    setCategoryFilter((prev) => (prev.includes(id) ? prev.filter((category) => category !== id) : [...prev, id]));
  }

  function clearFilters() {
    setSearch("");
    setLocalSearch("");
    setCategoryFilter([]);
  }

  const isCreating = createPipelineMutation.isPending || saveGraphMutation.isPending;
  const hasActiveFilters = search.length > 0 || categoryFilter.length > 0;

  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Templates"
        subtitle="Reusable pipeline patterns. Promote internal best practices into editable pipelines."
        meta={
          <>
            <span>{templates.length} templates</span>
            <span className="text-fg-3">·</span>
            <span>{templateStats.nodeCount} nodes</span>
            <span className="text-fg-3">·</span>
            <span>{templateStats.edgeCount} edges</span>
            <span className="text-fg-3">·</span>
            <span>{templateStats.customCount} custom</span>
          </>
        }
      />

      <div className="space-y-4 p-4">

      {!selectedEnvironmentId && (
        <EmptyState title="Select an environment from the header to use templates" className="p-4 text-sm" />
      )}

      <Card className="border-line bg-bg-2">
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-2" />
            <Input
              value={localSearch}
              onChange={(event) => setLocalSearch(event.target.value)}
              placeholder="Search templates, categories…"
              className="h-8 border-line-2 bg-bg-1 pl-8 font-mono text-[12px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {availableCategories.map((category) => {
              const Icon = category.icon;
              const active = categoryFilter.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[3px] border px-2.5 font-mono text-[10.5px] uppercase tracking-[0.05em] transition-colors",
                    active
                      ? "border-accent-line bg-accent-soft text-accent-brand"
                      : "border-line bg-bg-1 text-fg-2 hover:border-line-2 hover:text-fg",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", active ? "text-accent-brand" : category.color)} />
                  {category.id}
                </button>
              );
            })}
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-8 font-mono text-[11px]" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {featuredPacks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-accent-brand" />
            <h2 className="font-mono text-[12px] uppercase tracking-[0.05em] text-fg-2">
              Featured packs
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featuredPacks.map((pack) => (
              <Card key={pack.id} className="border-line bg-bg-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-fg">{pack.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="line-clamp-2 text-[12px] text-fg-2">{pack.description}</p>
                  <Badge variant="outline">
                    {pack.templateCount} {pack.templateCount === 1 ? "template" : "templates"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {templatesQuery.isError ? (
        <QueryError message="Failed to load templates" onRetry={() => templatesQuery.refetch()} />
      ) : templatesQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState icon={Terminal} title="No templates yet. Save a pipeline as a template to get started." />
      ) : filteredTemplates.length === 0 ? (
        <EmptyState icon={Search} title="No templates match your filters" description="Try adjusting your search or category filters." />
      ) : (
        <section className="space-y-3">
          {hasActiveFilters && (
            <p className="font-mono text-[11px] text-fg-2">
              {filteredTemplates.length} of {templates.length} templates
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                disabled={!selectedEnvironmentId || isCreating}
                isCreating={isCreating}
                onOpen={() => router.push(`/library/templates/${template.id}`)}
                onUse={() => handleUseTemplate(template.id)}
                onDelete={() => setDeleteConfirm({ id: template.id, name: template.name })}
              />
            ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Delete template?"
        description={
          <>
            Permanently delete <span className="font-medium">{deleteConfirm?.name}</span>? This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
        isPending={deleteTemplateMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (!deleteConfirm) return;
          deleteTemplateMutation.mutate({ id: deleteConfirm.id });
        }}
      />
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  disabled,
  isCreating,
  onOpen,
  onUse,
  onDelete,
}: {
  template: {
    id: string;
    name: string;
    description: string;
    category: string;
    teamId: string | null;
    nodes: unknown[];
    nodeCount: number;
    edgeCount: number;
  };
  disabled: boolean;
  isCreating: boolean;
  onOpen: () => void;
  onUse: () => void;
  onDelete: () => void;
}) {
  const Icon = categoryIcons[template.category] ?? FileText;
  const tags = getComplianceTags(template.nodes);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      className="group flex min-h-[220px] cursor-pointer flex-col border-line bg-bg-2 transition-colors hover:border-line-2 hover:bg-bg-3/60"
    >
      <CardHeader className="border-b border-line bg-bg-1/70 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-2">
              <Icon className={cn("h-3.5 w-3.5", categoryColors[template.category] ?? "text-fg-2")} />
              {template.category}
            </div>
            <CardTitle className="mt-2 truncate font-mono text-[15px] font-medium text-fg">{template.name}</CardTitle>
          </div>
          <Badge variant="outline" className="rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em]">
            {template.teamId === null ? "system" : "custom"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 p-4">
        <p className="line-clamp-3 text-[12px] leading-relaxed text-fg-1">{template.description}</p>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
          {template.nodes.slice(0, 5).map((node, index) => {
            const typedNode = node as TemplateNode;
            const nodeKind = typedNode.kind.toLowerCase();
            return (
              <span key={typedNode.id ?? index} className="inline-flex items-center gap-1 rounded-[3px] border border-line bg-bg-1 px-1.5 py-1 text-fg-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", nodeKind === "source" ? "bg-chart-1" : nodeKind === "sink" ? "bg-chart-3" : "bg-accent-brand")} />
                <span className="max-w-[120px] truncate">{typedNode.componentKey || typedNode.componentType}</span>
              </span>
            );
          })}
          {template.nodes.length > 5 && <span className="text-fg-2">+{template.nodes.length - 5}</span>}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className={cn("rounded-[3px] px-1.5 py-0 font-mono text-[10px] uppercase tracking-[0.04em]", complianceTagColors[tag])}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <MiniStat icon={Database} label="nodes" value={template.nodeCount} />
          <MiniStat icon={ArrowRight} label="edges" value={template.edgeCount} />
        </div>
      </CardContent>
      <CardFooter className="gap-2 border-t border-line bg-bg-1/60 p-3">
        <Button
          size="sm"
          variant="primary"
          className="flex-1"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onUse();
          }}
        >
          {isCreating ? "Creating..." : "Use template"}
        </Button>
        <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onOpen(); }}>
          Details
        </Button>
        {template.teamId !== null && (
          <Button
            size="sm"
            variant="ghost"
            className="text-status-error hover:text-status-error"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${template.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}


function MiniStat({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: number }) {
  return (
    <div className="rounded-[3px] border border-line bg-bg-1 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-fg-2">
        <Icon className="h-3 w-3" />
        <span className="uppercase tracking-[0.05em]">{label}</span>
      </div>
      <div className="mt-1 text-[15px] text-fg">{value}</div>
    </div>
  );
}
