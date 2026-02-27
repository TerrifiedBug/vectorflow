"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  FileText,
  Layers,
  Play,
  Trash2,
  ArrowRight,
  Database,
  Cloud,
  Radio,
  Cpu,
  Terminal,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  Category icon mapping                                              */
/* ------------------------------------------------------------------ */

const categoryIcons: Record<string, React.ReactNode> = {
  "Getting Started": <Play className="h-4 w-4" />,
  Logging: <FileText className="h-4 w-4" />,
  Archival: <Cloud className="h-4 w-4" />,
  Streaming: <Radio className="h-4 w-4" />,
  Metrics: <Cpu className="h-4 w-4" />,
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
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function TemplatesPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");

  // Fetch teams
  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const firstTeamId = teamsQuery.data?.[0]?.id;

  // Fetch environments
  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: firstTeamId! },
      { enabled: !!firstTeamId },
    ),
  );
  const environments = environmentsQuery.data ?? [];
  const effectiveEnvId = selectedEnvId || environments[0]?.id || "";

  // Fetch all templates (built-in + team's custom)
  const templatesQuery = useQuery(
    trpc.template.list.queryOptions(
      { teamId: firstTeamId },
      { enabled: !!firstTeamId },
    ),
  );

  const templates = templatesQuery.data ?? [];
  const builtinTemplates = templates.filter((t) => t.isBuiltin);
  const teamTemplates = templates.filter((t) => !t.isBuiltin);

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

  const deleteTemplateMutation = useMutation(
    trpc.template.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.template.list.queryKey() });
      },
    }),
  );

  const handleUseTemplate = async (templateId: string) => {
    if (!effectiveEnvId) return;

    // Get the full template data
    const template = await queryClient.fetchQuery(
      trpc.template.get.queryOptions({ id: templateId }),
    );

    // Create a new pipeline
    const pipeline = await createPipelineMutation.mutateAsync({
      name: `${template.name} Pipeline`,
      description: `Created from template: ${template.description}`,
      environmentId: effectiveEnvId,
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
      const newId = crypto.randomUUID();
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
      id: crypto.randomUUID(),
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

  const isLoading = teamsQuery.isLoading || templatesQuery.isLoading;
  const isCreating =
    createPipelineMutation.isPending || saveGraphMutation.isPending;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Templates</h2>
          <p className="text-muted-foreground">
            Start from a pre-built pipeline template or create your own
          </p>
        </div>
      </div>

      {/* Environment selector */}
      {environments.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground">
            Target Environment
          </label>
          <Select value={effectiveEnvId} onValueChange={setSelectedEnvId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select environment" />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* Built-in Templates */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Built-in Templates</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {builtinTemplates.map((template) => (
                <Card key={template.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {template.name}
                      </CardTitle>
                      <Badge
                        variant="secondary"
                        className={categoryColors[template.category] ?? ""}
                      >
                        {categoryIcons[template.category]}
                        <span className="ml-1">{template.category}</span>
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
                  <CardFooter className="pt-0">
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!effectiveEnvId || isCreating}
                      onClick={() => handleUseTemplate(template.id)}
                    >
                      {isCreating ? "Creating..." : "Use Template"}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </section>

          <Separator />

          {/* Team Templates */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Team Templates</h3>
            </div>

            {teamTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                <p className="text-muted-foreground">
                  No custom templates yet
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save a pipeline as a template from the pipeline builder to
                  create reusable configurations.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {teamTemplates.map((template) => (
                  <Card key={template.id} className="flex flex-col">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">
                          {template.name}
                        </CardTitle>
                        <Badge variant="outline">{template.category}</Badge>
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
                        disabled={!effectiveEnvId || isCreating}
                        onClick={() => handleUseTemplate(template.id)}
                      >
                        {isCreating ? "Creating..." : "Use Template"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          deleteTemplateMutation.mutate({ id: template.id })
                        }
                        disabled={deleteTemplateMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
