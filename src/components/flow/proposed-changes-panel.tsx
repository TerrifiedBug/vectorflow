"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

interface ProposedChangesPanelProps {
  pipelineId: string;
}

interface ValidationSummary {
  valid?: boolean;
  errors?: Array<{ message: string }>;
  error?: string | null;
  autoFixAttempts?: number;
}

/**
 * "Proposed changes" section of the AI dialog. Lists staged AI proposals
 * (newest first), surfaces each one's validation status + diagnostics, and lets
 * an EDITOR Approve (apply to draft) or Reject. Approve is disabled for an
 * unvalidated change — bad AI output is shown, never applied.
 */
export function ProposedChangesPanel({ pipelineId }: ProposedChangesPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const changesQuery = useQuery(
    trpc.proposedChange.list.queryOptions({ pipelineId }, { enabled: !!pipelineId }),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.proposedChange.list.queryKey({ pipelineId }) });
  };

  const approve = useMutation(
    trpc.proposedChange.approve.mutationOptions({
      onSuccess: () => {
        toast.success("Change applied to the pipeline draft. Deploy it from the release flow when ready.");
        invalidate();
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
      },
      onError: (err) => toast.error(err.message || "Failed to apply change"),
    }),
  );

  const reject = useMutation(
    trpc.proposedChange.reject.mutationOptions({
      onSuccess: () => {
        toast.success("Change rejected");
        invalidate();
      },
      onError: (err) => toast.error(err.message || "Failed to reject change"),
    }),
  );

  if (changesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-fg-2" />
      </div>
    );
  }

  const changes = changesQuery.data ?? [];
  if (changes.length === 0) {
    return (
      <p className="py-8 text-center font-mono text-[12px] text-fg-2">
        No AI-proposed changes yet. Generate or review a pipeline to stage one.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {changes.map((change) => {
        const validation = (change.validationResult as ValidationSummary | null) ?? {};
        const isPending = change.status === "PENDING";
        const busy = approve.isPending || reject.isPending;
        const diffSummary =
          change.kind === "VRL"
            ? `VRL · ${change.targetComponentKey ?? "component"}`
            : `Graph · ${Array.isArray(change.proposedNodes) ? change.proposedNodes.length : 0} nodes`;

        return (
          <div
            key={change.id}
            className="space-y-2 rounded-[3px] border border-line bg-bg p-3 text-[12px]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-fg">{change.summary}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-2">
                  {diffSummary} · {change.status.toLowerCase()}
                </p>
              </div>
              {change.validated ? (
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-500">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Validated
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Failed validation
                </span>
              )}
            </div>

            {!change.validated && (validation.error || validation.errors?.length) && (
              <div className="rounded-[3px] border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 font-mono text-[11px] text-destructive">
                {validation.error ??
                  validation.errors?.map((e) => e.message).join("\n") ??
                  "Validation failed."}
                {typeof validation.autoFixAttempts === "number" && validation.autoFixAttempts > 0 && (
                  <span className="mt-1 block text-fg-2">
                    Auto-fix attempted {validation.autoFixAttempts}×.
                  </span>
                )}
              </div>
            )}

            {isPending && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={!change.validated || busy}
                  onClick={() => approve.mutate({ pipelineId, changeId: change.id })}
                  title={change.validated ? undefined : "Cannot apply a change that failed validation"}
                >
                  <CheckCircle2 className="mr-1.5 h-3 w-3" />
                  Approve & apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => reject.mutate({ pipelineId, changeId: change.id })}
                >
                  <XCircle className="mr-1.5 h-3 w-3" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
