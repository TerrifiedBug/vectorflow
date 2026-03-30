// src/components/analytics/cost-settings.tsx
"use client";

import { useState } from "react";
import { useTRPC } from "@/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useEnvironmentStore } from "@/stores/environment-store";
import { toast } from "sonner";

export function CostSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { selectedEnvironmentId } = useEnvironmentStore();

  const envQuery = useQuery({
    ...trpc.environment.get.queryOptions({
      id: selectedEnvironmentId ?? "",
    }),
    enabled: !!selectedEnvironmentId,
  });

  const [costRate, setCostRate] = useState<string>("");
  const [budget, setBudget] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  // Initialize form values from server data
  if (envQuery.data && !initialized) {
    const env = envQuery.data;
    setCostRate(env.costPerGbCents > 0 ? (env.costPerGbCents / 100).toString() : "");
    setBudget(env.costBudgetCents != null ? (env.costBudgetCents / 100).toString() : "");
    setInitialized(true);
  }

  const updateMutation = useMutation({
    ...trpc.environment.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Cost settings updated");
      void queryClient.invalidateQueries();
    },
    onError: (err) => {
      toast.error(`Failed to update: ${err.message}`);
    },
  });

  const handleSave = () => {
    if (!selectedEnvironmentId) return;

    const costPerGbCents = costRate ? Math.round(parseFloat(costRate) * 100) : 0;
    const costBudgetCents = budget ? Math.round(parseFloat(budget) * 100) : null;

    if (isNaN(costPerGbCents) || costPerGbCents < 0) {
      toast.error("Cost rate must be a positive number");
      return;
    }

    if (costBudgetCents !== null && (isNaN(costBudgetCents) || costBudgetCents < 0)) {
      toast.error("Budget must be a positive number");
      return;
    }

    updateMutation.mutate({
      id: selectedEnvironmentId,
      costPerGbCents,
      costBudgetCents,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Cost Attribution Settings</CardTitle>
        <CardDescription>
          Configure cost rate and budget alerts for this environment. Set the rate
          to 0 to show volume-only metrics without cost estimates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cost-rate">Cost Rate ($/GB)</Label>
            <Input
              id="cost-rate"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={costRate}
              onChange={(e) => setCostRate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Egress cost per GB processed. Varies by cloud provider and region.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cost-budget">Monthly Budget ($)</Label>
            <Input
              id="cost-budget"
              type="number"
              step="1"
              min="0"
              placeholder="No budget limit"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Alert when monthly cost exceeds this amount. Leave empty to disable.
            </p>
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          size="sm"
        >
          {updateMutation.isPending ? "Saving..." : "Save Cost Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
