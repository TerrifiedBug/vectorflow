"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface IncidentCopilotPanelProps {
  pipelineId?: string;
  environmentId?: string;
}

/**
 * Incident copilot affordance shown alongside alerts/anomalies. Asks the
 * copilot to correlate the recent anomaly + release timeline and, when a deploy
 * precedes an anomaly onset, proposes a rollback the operator can apply with one
 * (audited) click. Never auto-applies — the proposal renders, the human decides.
 */
export function IncidentCopilotPanel({ pipelineId, environmentId }: IncidentCopilotPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const copilotQuery = useQuery(
    trpc.proposedChange.incidentCopilot.queryOptions(
      { pipelineId, environmentId },
      { enabled: false, retry: false },
    ),
  );

  const applyRollback = useMutation(
    trpc.proposedChange.applyIncidentAction.mutationOptions({
      onSuccess: () => {
        toast.success("Rollback dispatched — the previous version is being redeployed.");
        queryClient.invalidateQueries({ queryKey: trpc.proposedChange.incidentCopilot.queryKey() });
        void copilotQuery.refetch();
      },
      onError: (err) => {
        toast.error(err.message || "Failed to dispatch rollback");
      },
    }),
  );

  const proposal = copilotQuery.data;
  const action = proposal?.suggestedAction;

  return (
    <Card className="rounded-[3px] border-line-2 bg-bg-2">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 font-mono text-[13px] font-semibold">
          <Sparkles className="h-4 w-4 text-accent-brand" />
          Incident copilot
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          disabled={copilotQuery.isFetching}
          onClick={() => void copilotQuery.refetch()}
        >
          {copilotQuery.isFetching ? (
            <>
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              Analyzing…
            </>
          ) : (
            "Analyze incident"
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-[12px] text-fg-1">
        {copilotQuery.isError && (
          <div className="flex items-start gap-2 rounded-[3px] border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {copilotQuery.error?.message}
          </div>
        )}

        {!proposal && !copilotQuery.isError && (
          <p className="text-fg-2">
            Correlate recent anomalies against the release timeline to find a deploy that may have
            caused the incident.
          </p>
        )}

        {proposal && (
          <p className="whitespace-pre-wrap leading-relaxed">{proposal.summary}</p>
        )}

        {action?.type === "rollback" && (
          <div className="flex items-center justify-between gap-2 rounded-[3px] border border-line bg-bg px-3 py-2">
            <span className="font-mono text-[11px] text-fg-2">
              Release {action.releaseId} · {action.strategy.toLowerCase()}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={applyRollback.isPending}
              onClick={() =>
                applyRollback.mutate({
                  pipelineId: action.pipelineId,
                  releaseId: action.releaseId,
                })
              }
            >
              {applyRollback.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Rolling back…
                </>
              ) : (
                <>
                  <Undo2 className="mr-1.5 h-3 w-3" />
                  Apply rollback
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
