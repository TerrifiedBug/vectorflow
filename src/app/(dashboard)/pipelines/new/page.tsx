"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function NewPipelinePage() {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");

  // Fetch teams first, then environments
  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const firstTeamId = teamsQuery.data?.[0]?.id;

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: firstTeamId! },
      { enabled: !!firstTeamId }
    )
  );

  const environments = environmentsQuery.data ?? [];
  const effectiveEnvId = selectedEnvId || environments[0]?.id || "";

  const createMutation = useMutation(
    trpc.pipeline.create.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.list.queryKey(),
        });
        toast.success("Pipeline created successfully");
        router.push(`/pipelines/${data.id}`);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create pipeline");
      },
    })
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveEnvId) {
      toast.error("Please select an environment");
      return;
    }

    createMutation.mutate({
      name,
      description: description || undefined,
      environmentId: effectiveEnvId,
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">New Pipeline</h2>
        <p className="text-muted-foreground">
          Create a new data processing pipeline
        </p>
      </div>

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
              <Label htmlFor="environment">Environment</Label>
              <Select
                value={effectiveEnvId}
                onValueChange={setSelectedEnvId}
              >
                <SelectTrigger id="environment" className="w-full">
                  <SelectValue placeholder="Select an environment" />
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

            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={
                  createMutation.isPending || !name || !effectiveEnvId
                }
              >
                {createMutation.isPending ? "Creating..." : "Create Pipeline"}
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
