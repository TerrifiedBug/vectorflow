"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PromoteResult {
  id: string;
  name: string;
  targetEnvironmentName: string;
  strippedSecrets: Array<{ name: string; componentKey: string }>;
  strippedCertificates: Array<{ name: string; componentKey: string }>;
}

interface PromotePipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: { id: string; name: string; environmentId: string };
}

export function PromotePipelineDialog({
  open,
  onOpenChange,
  pipeline,
}: PromotePipelineDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const [targetEnvId, setTargetEnvId] = useState("");
  const [name, setName] = useState(pipeline.name);
  const [result, setResult] = useState<PromoteResult | null>(null);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId && open }
    )
  );

  const availableEnvironments = (environmentsQuery.data ?? []).filter(
    (env) => env.id !== pipeline.environmentId
  );

  const promoteMutation = useMutation(
    trpc.pipeline.promote.mutationOptions({
      onSuccess: (data) => {
        setResult(data);
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.list.queryKey(),
        });
      },
      onError: (err) =>
        toast.error(err.message || "Failed to promote pipeline"),
    })
  );

  const handleClose = (openState: boolean) => {
    if (!openState) {
      setTargetEnvId("");
      setName(pipeline.name);
      setResult(null);
    }
    onOpenChange(openState);
  };

  const hasStrippedItems =
    result &&
    (result.strippedSecrets.length > 0 ||
      result.strippedCertificates.length > 0);

  if (result) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pipeline Promoted</DialogTitle>
            <DialogDescription>
              Pipeline promoted to {result.targetEnvironmentName} as a draft.
            </DialogDescription>
          </DialogHeader>

          {hasStrippedItems && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-medium mb-1">
                    The following references were stripped and need to be
                    re-configured in the target environment:
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {result.strippedSecrets.map((s, i) => (
                      <li key={`secret-${i}`}>
                        Secret <code className="text-xs">{s.name}</code> in{" "}
                        <code className="text-xs">{s.componentKey}</code>
                      </li>
                    ))}
                    {result.strippedCertificates.map((c, i) => (
                      <li key={`cert-${i}`}>
                        Certificate <code className="text-xs">{c.name}</code> in{" "}
                        <code className="text-xs">{c.componentKey}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)}>
              Close
            </Button>
            <Button asChild>
              <Link href={`/pipelines/${result.id}`}>Go to Pipeline</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote Pipeline</DialogTitle>
          <DialogDescription>
            Copy this pipeline to another environment. Secrets and certificates
            will be stripped and must be re-configured.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="promote-target-env">Target Environment</Label>
            <Select value={targetEnvId} onValueChange={setTargetEnvId}>
              <SelectTrigger id="promote-target-env" className="w-full">
                <SelectValue placeholder="Select environment..." />
              </SelectTrigger>
              <SelectContent>
                {availableEnvironments.map((env) => (
                  <SelectItem key={env.id} value={env.id}>
                    {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="promote-pipeline-name">Pipeline Name</Label>
            <Input
              id="promote-pipeline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            disabled={!targetEnvId || promoteMutation.isPending}
            onClick={() =>
              promoteMutation.mutate({
                pipelineId: pipeline.id,
                targetEnvironmentId: targetEnvId,
                name: name || undefined,
              })
            }
          >
            {promoteMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Promoting...
              </>
            ) : (
              "Promote"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
