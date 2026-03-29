"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { generateId } from "@/lib/utils";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

/* ------------------------------------------------------------------ */
/*  Category icon mapping                                              */
/* ------------------------------------------------------------------ */

const categoryIcons: Record<string, React.ReactNode> = {
  "Getting Started": <Play className="h-4 w-4" />,
  Logging: <FileText className="h-4 w-4" />,
  Archival: <Cloud className="h-4 w-4" />,
  Streaming: <Radio className="h-4 w-4" />,
  Metrics: <Cpu className="h-4 w-4" />,
  "Data Protection": <Shield className="h-4 w-4" />,
};

const categoryColors: Record<string, string> = {
  "Getting Started":
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Logging:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Archival:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  Streaming:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  Metrics:
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  "Data Protection":
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const complianceTagColors: Record<string, string> = {
  "PCI-DSS": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  HIPAA: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  GDPR: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
};

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

  const templates = templatesQuery.data ?? [];

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
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
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirm({ id: template.id, name: template.name })}
                    disabled={deleteTemplateMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
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
