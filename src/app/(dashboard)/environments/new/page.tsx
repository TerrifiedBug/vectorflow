"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DeployMode = "API_RELOAD" | "GITOPS";

export default function NewEnvironmentPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [deployMode, setDeployMode] = useState<DeployMode>("API_RELOAD");
  const [gitRepo, setGitRepo] = useState("");
  const [gitBranch, setGitBranch] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const teams = teamsQuery.data ?? [];

  // Auto-select first team when teams load
  const effectiveTeamId = selectedTeamId || teams[0]?.id || "";

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

    if (!effectiveTeamId) {
      toast.error("Please select a team");
      return;
    }

    createMutation.mutate({
      name,
      teamId: effectiveTeamId,
      deployMode,
      ...(deployMode === "GITOPS" && gitRepo ? { gitRepo } : {}),
      ...(deployMode === "GITOPS" && gitBranch ? { gitBranch } : {}),
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

            {teams.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="team">Team</Label>
                <Select
                  value={effectiveTeamId}
                  onValueChange={setSelectedTeamId}
                >
                  <SelectTrigger id="team" className="w-full">
                    <SelectValue placeholder="Select a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="deployMode">Deploy Mode</Label>
              <Select
                value={deployMode}
                onValueChange={(val) => setDeployMode(val as DeployMode)}
              >
                <SelectTrigger id="deployMode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="API_RELOAD">API Reload</SelectItem>
                  <SelectItem value="GITOPS">GitOps</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {deployMode === "GITOPS" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="gitRepo">Git Repository</Label>
                  <Input
                    id="gitRepo"
                    placeholder="e.g., https://github.com/org/vector-configs"
                    value={gitRepo}
                    onChange={(e) => setGitRepo(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gitBranch">Git Branch</Label>
                  <Input
                    id="gitBranch"
                    placeholder="e.g., main"
                    value={gitBranch}
                    onChange={(e) => setGitBranch(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={createMutation.isPending || !name || !effectiveTeamId}
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
