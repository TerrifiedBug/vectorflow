"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Status badge config ──────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  CANARY_DEPLOYED: { label: "Canary Deployed", variant: "default", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  HEALTH_CHECK: { label: "Health Check Ready", variant: "default", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  BROADENED: { label: "Broadened", variant: "default", className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
  ROLLED_BACK: { label: "Rolled Back", variant: "destructive", className: "" },
};

// ── Countdown hook ───────────────────────────────────────────────────

function useCountdown(expiresAt: Date | string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt) return "";
  const expiry = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  const remaining = Math.max(0, expiry - now);
  if (remaining <= 0) return "Expired";
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

// ── Component ────────────────────────────────────────────────────────

interface StagedRolloutPanelProps {
  pipelineId: string;
}

export function StagedRolloutPanel({ pipelineId }: StagedRolloutPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const activeQuery = useQuery({
    ...trpc.stagedRollout.getActive.queryOptions({ pipelineId }),
    refetchInterval: 10_000, // Poll for status changes
  });

  const rollout = activeQuery.data;

  const broadenMutation = useMutation(
    trpc.stagedRollout.broaden.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast.success("Canary broadened to all nodes");
      },
      onError: (err) => {
        toast.error("Broaden failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const rollbackMutation = useMutation(
    trpc.stagedRollout.rollback.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast.success("Canary deploy rolled back");
      },
      onError: (err) => {
        toast.error("Rollback failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const countdown = useCountdown(rollout?.healthCheckExpiresAt);

  if (!rollout) return null;

  const canaryNodeIds = (rollout.canaryNodeIds as string[]) ?? [];
  const remainingNodeIds = (rollout.remainingNodeIds as string[]) ?? [];
  const statusConfig = STATUS_CONFIG[rollout.status] ?? { label: rollout.status, variant: "outline" as const, className: "" };
  const isActing = broadenMutation.isPending || rollbackMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Staged Rollout</CardTitle>
          <Badge variant={statusConfig.variant} className={statusConfig.className}>
            {statusConfig.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>{canaryNodeIds.length} canary node{canaryNodeIds.length !== 1 ? "s" : ""}</span>
          <span>{remainingNodeIds.length} remaining</span>
        </div>

        {rollout.canaryVersion && (
          <p className="text-xs text-muted-foreground">
            Canary version: v{rollout.canaryVersion.version}
            {rollout.canaryVersion.changelog && ` — ${rollout.canaryVersion.changelog}`}
          </p>
        )}

        {rollout.status === "CANARY_DEPLOYED" && (
          <div className="space-y-2">
            <p className="text-xs font-medium">
              Health check window: <span className="text-muted-foreground">{countdown}</span>
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={isActing}
              onClick={() => rollbackMutation.mutate({ rolloutId: rollout.id })}
            >
              {rollbackMutation.isPending ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Rolling back...</>
              ) : (
                "Rollback Canary"
              )}
            </Button>
          </div>
        )}

        {rollout.status === "HEALTH_CHECK" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isActing}
              onClick={() => broadenMutation.mutate({ rolloutId: rollout.id })}
            >
              {broadenMutation.isPending ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Broadening...</>
              ) : (
                "Broaden to All Nodes"
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isActing}
              onClick={() => rollbackMutation.mutate({ rolloutId: rollout.id })}
            >
              {rollbackMutation.isPending ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Rolling back...</>
              ) : (
                "Rollback Canary"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
