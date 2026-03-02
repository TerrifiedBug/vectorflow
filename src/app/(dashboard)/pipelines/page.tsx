"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Copy, Trash2, BarChart3, Info } from "lucide-react";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCount, formatBytes } from "@/lib/format";

function aggregateProcessStatus(
  statuses: Array<{ status: string }>
): "RUNNING" | "STARTING" | "STOPPED" | "CRASHED" | "PENDING" | null {
  if (statuses.length === 0) return null;
  if (statuses.some((s) => s.status === "CRASHED")) return "CRASHED";
  if (statuses.some((s) => s.status === "STOPPED")) return "STOPPED";
  if (statuses.some((s) => s.status === "STARTING")) return "STARTING";
  if (statuses.some((s) => s.status === "PENDING")) return "PENDING";
  return "RUNNING";
}

function sumNodeStatuses(statuses: Array<{ eventsIn: bigint; eventsOut: bigint; errorsTotal: bigint; eventsDiscarded: bigint; bytesIn: bigint; bytesOut: bigint }>) {
  let eventsIn = BigInt(0), eventsOut = BigInt(0), errorsTotal = BigInt(0), eventsDiscarded = BigInt(0), bytesIn = BigInt(0), bytesOut = BigInt(0);
  for (const s of statuses) {
    eventsIn += BigInt(s.eventsIn);
    eventsOut += BigInt(s.eventsOut);
    errorsTotal += BigInt(s.errorsTotal);
    eventsDiscarded += BigInt(s.eventsDiscarded);
    bytesIn += BigInt(s.bytesIn);
    bytesOut += BigInt(s.bytesOut);
  }
  return { eventsIn, eventsOut, errorsTotal, eventsDiscarded, bytesIn, bytesOut };
}

export default function PipelinesPage() {
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  // Fetch environments for the selected team
  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId }
    )
  );

  const environments = environmentsQuery.data ?? [];
  const effectiveEnvId = selectedEnvironmentId || environments[0]?.id || "";

  // Fetch pipelines for the selected environment
  const pipelinesQuery = useQuery(
    trpc.pipeline.list.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId }
    )
  );

  const pipelines = pipelinesQuery.data ?? [];

  const router = useRouter();
  const queryClient = useQueryClient();

  const cloneMutation = useMutation(
    trpc.pipeline.clone.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Cloned as "${data.name}"`);
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
        router.push(`/pipelines/${data.id}`);
      },
      onError: (err) => toast.error(err.message || "Failed to clone pipeline"),
    })
  );

  const deleteMutation = useMutation(
    trpc.pipeline.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Pipeline deleted");
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
      },
      onError: (err) => toast.error(err.message || "Failed to delete pipeline"),
    })
  );

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const isLoading =
    environmentsQuery.isLoading ||
    pipelinesQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Pipelines</h2>
          <p className="text-muted-foreground">
            Manage your data processing pipelines
          </p>
        </div>
        <Button asChild>
          <Link href="/pipelines/new">
            <Plus className="mr-2 h-4 w-4" />
            New Pipeline
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No pipelines yet</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/pipelines/new">Create your first pipeline</Link>
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total Events In / Out</TableHead>
              <TableHead className="text-right">
                <span className="inline-flex items-center gap-1">
                  Total Bytes In / Out
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>Measured before sink-side compression</TooltipContent>
                  </Tooltip>
                </span>
              </TableHead>
              <TableHead className="text-right">Errors / Discarded</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pipelines.map((pipeline) => {
              const hasStats = pipeline.nodeStatuses.length > 0;
              const totals = hasStats ? sumNodeStatuses(pipeline.nodeStatuses) : null;
              return (
              <TableRow key={pipeline.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link
                    href={`/pipelines/${pipeline.id}`}
                    className="hover:underline"
                  >
                    {pipeline.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                  {pipeline.isDraft ? (
                    <Badge variant="secondary">Draft</Badge>
                  ) : (() => {
                    const ps = aggregateProcessStatus(pipeline.nodeStatuses);
                    if (ps === "RUNNING") return <Badge variant="default">Running</Badge>;
                    if (ps === "CRASHED") return <Badge variant="destructive">Crashed</Badge>;
                    if (ps === "STOPPED") return <Badge variant="outline">Stopped</Badge>;
                    if (ps === "STARTING" || ps === "PENDING") return <Badge variant="secondary">Starting...</Badge>;
                    return <Badge variant="default">Deployed</Badge>;
                  })()}
                  {!pipeline.isDraft && pipeline.hasUndeployedChanges && (
                    <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                      Pending deploy
                    </Badge>
                  )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {totals
                    ? `${formatCount(totals.eventsIn)} / ${formatCount(totals.eventsOut)}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {totals
                    ? `${formatBytes(totals.bytesIn)} / ${formatBytes(totals.bytesOut)}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {totals
                    ? `${formatCount(totals.errorsTotal)} / ${formatCount(totals.eventsDiscarded)}`
                    : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(pipeline.updatedAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Pipeline actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/pipelines/${pipeline.id}/metrics`}>
                          <BarChart3 className="mr-2 h-4 w-4" />
                          Metrics
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => cloneMutation.mutate({ pipelineId: pipeline.id })}
                        disabled={cloneMutation.isPending}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Clone
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteTarget({ id: pipeline.id, name: pipeline.name })}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete pipeline?"
        description={
          <>
            This will permanently delete &quot;{deleteTarget?.name}&quot; and all its versions. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
