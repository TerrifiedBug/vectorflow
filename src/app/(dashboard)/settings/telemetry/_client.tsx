"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TelemetrySettingsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery(trpc.telemetry.get.queryOptions());

  const update = useMutation(
    trpc.telemetry.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.telemetry.get.queryKey(),
        });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update telemetry settings", {
          duration: 6000,
        });
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telemetry</CardTitle>
        <CardDescription>
          Send anonymous, aggregate usage stats to help improve VectorFlow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-6 w-48" />
        ) : (
          <div className="flex items-center gap-3">
            <Switch
              id="telemetry-toggle"
              checked={data?.enabled ?? false}
              disabled={isLoading || update.isPending}
              onCheckedChange={(checked) => update.mutate({ enabled: checked })}
            />
            <Label htmlFor="telemetry-toggle">
              {data?.enabled ? "Enabled" : "Disabled"}
            </Label>
          </div>
        )}

        <a
          href="https://vectorflow.sh/docs/operations/telemetry"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline inline-block"
        >
          Read what we collect →
        </a>
      </CardContent>
    </Card>
  );
}
