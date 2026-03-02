"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { FileText, Workflow } from "lucide-react";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { useFormField, useFormStore } from "@/stores/form-store";
import { generateId } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default function NewPipelinePage() {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useFormField("pipeline-new", "name", "");
  const [description, setDescription] = useFormField("pipeline-new", "description", "");
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId }
    )
  );

  const templatesQuery = useQuery(
    trpc.template.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId }
    )
  );

  const environments = environmentsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const effectiveEnvId = selectedEnvironmentId || environments[0]?.id || "";

  const createMutation = useMutation(
    trpc.pipeline.create.mutationOptions({
      onError: (error) => {
        toast.error(error.message || "Failed to create pipeline");
      },
    })
  );

  const saveGraphMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({})
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveEnvId) {
      toast.error("Please select an environment");
      return;
    }

    try {
      // Create the pipeline
      const pipeline = await createMutation.mutateAsync({
        name,
        description: description || undefined,
        environmentId: effectiveEnvId,
      });

      // If a template was selected, populate the pipeline graph
      if (selectedTemplateId) {
        const template = await queryClient.fetchQuery(
          trpc.template.get.queryOptions({ id: selectedTemplateId })
        );

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

        const pipelineEdges = templateEdges.map((edge) => ({
          id: generateId(),
          sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
          targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId,
          sourcePort: edge.sourcePort,
        }));

        await saveGraphMutation.mutateAsync({
          pipelineId: pipeline.id,
          nodes: pipelineNodes,
          edges: pipelineEdges,
        });
      }

      queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
      toast.success("Pipeline created");
      useFormStore.getState().clearForm("pipeline-new");
      router.push(`/pipelines/${pipeline.id}`);
    } catch {
      // Error already handled by mutation onError
    }
  };

  const isCreating = createMutation.isPending || saveGraphMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">New Pipeline</h2>
        <p className="text-muted-foreground">
          Create a new data processing pipeline
        </p>
      </div>

      {/* Template Selection */}
      {templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Start from a Template</CardTitle>
            <CardDescription>
              Choose a template to pre-populate your pipeline, or start blank.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {/* Blank option */}
              <button
                type="button"
                onClick={() => setSelectedTemplateId(null)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                  selectedTemplateId === null && "border-primary ring-2 ring-primary/20"
                )}
              >
                <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Blank Pipeline</p>
                  <p className="text-xs text-muted-foreground">Start from scratch</p>
                </div>
              </button>

              {/* Template options */}
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(t.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                    selectedTemplateId === t.id && "border-primary ring-2 ring-primary/20"
                  )}
                >
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                        {t.nodeCount}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Details */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Details</CardTitle>
          <CardDescription>
            Configure the basic settings for your pipeline
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Log Processing Pipeline"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Describe what this pipeline does..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Environment</Label>
              <p className="text-sm">
                {environments.find((e) => e.id === effectiveEnvId)?.name ?? "No environment selected"}
              </p>
              <p className="text-xs text-muted-foreground">
                Change the environment using the selector in the header
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={isCreating || !name || !effectiveEnvId}
              >
                {isCreating ? "Creating..." : selectedTemplateId ? "Create from Template" : "Create Pipeline"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/pipelines")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
