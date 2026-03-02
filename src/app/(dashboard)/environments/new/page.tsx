"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { useFormField, useFormStore } from "@/stores/form-store";
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

  const [name, setName] = useFormField("env-new", "name", "");

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const createMutation = useMutation(
    trpc.environment.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.environment.list.queryKey() });
        toast.success("Environment created successfully");
        useFormStore.getState().clearForm("env-new");
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
    });
  };

  const isValid = !!name && !!selectedTeamId;

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

            {/* Agent info */}
            <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-muted-foreground space-y-2">
              <p>
                After creating this environment, you&apos;ll generate an enrollment token in the environment settings.
                Use that token to connect agents:
              </p>
              <pre className="rounded bg-muted px-3 py-2 text-xs">
                {`VF_URL=https://your-vectorflow-instance:3000
VF_TOKEN=<enrollment-token>
./vf-agent`}
              </pre>
            </div>

            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={createMutation.isPending || !isValid}
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
