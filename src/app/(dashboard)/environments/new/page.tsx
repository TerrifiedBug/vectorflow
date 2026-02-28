"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export default function NewEnvironmentPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [gitRepo, setGitRepo] = useState("");
  const [gitBranch, setGitBranch] = useState("");

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const createMutation = useMutation(
    trpc.environment.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.environment.list.queryKey() });
        toast.success("Environment created successfully");
        router.push("/environments");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create environment");
      },
    })
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTeamId) {
      toast.error("Please select a team");
      return;
    }

    createMutation.mutate({
      name,
      teamId: selectedTeamId,
      gitRepo,
      gitBranch,
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          New Environment
        </h2>
        <p className="text-muted-foreground">
          Create a new deployment environment for your pipelines
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Environment Details</CardTitle>
          <CardDescription>
            Configure the basic settings for your environment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Production, Staging"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gitRepo">Git Repository</Label>
              <Input
                id="gitRepo"
                placeholder="https://github.com/org/repo.git or git@github.com:org/repo.git"
                value={gitRepo}
                onChange={(e) => setGitRepo(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Use HTTPS with a token (Settings &rarr; GitOps) or SSH with a deploy key
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gitBranch">Git Branch</Label>
              <Input
                id="gitBranch"
                placeholder="e.g., main"
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                required
              />
            </div>

            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={createMutation.isPending || !name || !selectedTeamId || !gitRepo || !gitBranch}
              >
                {createMutation.isPending ? "Creating..." : "Create Environment"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/environments")}
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
