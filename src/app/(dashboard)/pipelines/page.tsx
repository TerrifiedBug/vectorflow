"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Copy, Trash2, BarChart3, ArrowUpRight } from "lucide-react";
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
import { PromotePipelineDialog } from "@/components/promote-pipeline-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatEventsRate, formatBytesRate } from "@/lib/format";

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

function getUserInitials(user: { name?: string | null; email?: string | null } | null | undefined): string {
  if (user?.name) {
    const parts = user.name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (user?.email) return user.email[0].toUpperCase();
  return "?";
}

function getReductionPercent(totals: { eventsIn: bigint; eventsOut: bigint }): number | null {
  const evIn = Number(totals.eventsIn);
  const evOut = Number(totals.eventsOut);
  if (evIn === 0) return null;
  return Math.max(0, (1 - evOut / evIn) * 100);
}

function reductionColor(pct: number): string {
  if (pct > 50) return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  if (pct > 10) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function tagBadgeClass(tag: string): string {
  const upper = tag.toUpperCase();
  if (upper === "PII") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (upper === "PHI") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (upper === "PCI-DSS") return "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30";
  if (upper === "INTERNAL") return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
  if (upper === "PUBLIC") return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  return "bg-muted text-muted-foreground";
}

function PipelineHealthBadge({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const healthQuery = useQuery(
    trpc.pipeline.health.queryOptions(
      { pipelineId },
      { refetchInterval: 30_000 },
    ),
  );
  const status = healthQuery.data?.status ?? null;
  if (!status || status === "no_data") return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status === "healthy" ? "bg-green-500" : "bg-yellow-500"
          }`}
        />
      </TooltipTrigger>
      <TooltipContent>
        {status === "healthy" ? "All SLIs met" : "One or more SLIs breached"}
      </TooltipContent>
    </Tooltip>
  );
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

  // Poll live rates from MetricStore for the pipelines table
  const liveRatesQuery = useQuery(
    trpc.metrics.getLiveRates.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId, refetchInterval: 15_000 }
    )
  );
  const liveRates = liveRatesQuery.data?.rates ?? {};

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
  const [promoteTarget, setPromoteTarget] = useState<{ id: string; name: string; environmentId: string } | null>(null);

  const isLoading =
    environmentsQuery.isLoading ||
    pipelinesQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
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
              <TableHead>Health</TableHead>
              <TableHead className="text-right">Events/sec In</TableHead>
              <TableHead className="text-right">Bytes/sec In</TableHead>
              <TableHead className="text-right">Reduction</TableHead>
              <TableHead>Created</TableHead>
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
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/pipelines/${pipeline.id}`}
                      className="hover:underline"
                    >
                      {pipeline.name}
                    </Link>
                    {(pipeline.tags as string[])?.length > 0 && (
                      <div className="flex items-center gap-1">
                        {(pipeline.tags as string[]).map((tag) => (
                          <Badge key={tag} variant="outline" className={`text-[10px] px-1.5 py-0 ${tagBadgeClass(tag)}`}>
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
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
                {/* Health */}
                <TableCell>
                  {pipeline.isDraft ? (
                    <span className="text-sm text-muted-foreground">--</span>
                  ) : (
                    <PipelineHealthBadge pipelineId={pipeline.id} />
                  )}
                </TableCell>
                {/* Events/sec In */}
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {liveRates[pipeline.id]
                    ? formatEventsRate(liveRates[pipeline.id].eventsPerSec)
                    : "—"}
                </TableCell>
                {/* Bytes/sec In */}
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {liveRates[pipeline.id]
                    ? formatBytesRate(liveRates[pipeline.id].bytesPerSec)
                    : "—"}
                </TableCell>
                {/* Reduction */}
                <TableCell className="text-right">
                  {(() => {
                    const pct = totals ? getReductionPercent(totals) : null;
                    if (pct == null) return <span className="text-sm text-muted-foreground">—</span>;
                    return (
                      <Badge variant="outline" className={reductionColor(pct)}>
                        {pct.toFixed(0)}%
                      </Badge>
                    );
                  })()}
                </TableCell>
                {/* Created */}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Avatar className="h-5 w-5">
                            {pipeline.createdBy?.image && <AvatarImage src={pipeline.createdBy.image} alt={pipeline.createdBy.name ?? ""} />}
                            <AvatarFallback className="text-[10px]">{getUserInitials(pipeline.createdBy)}</AvatarFallback>
                          </Avatar>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{pipeline.createdBy?.name ?? pipeline.createdBy?.email ?? "Unknown"}</TooltipContent>
                    </Tooltip>
                    <span className="text-sm text-muted-foreground">
                      {new Date(pipeline.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </TableCell>
                {/* Last Updated */}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Avatar className="h-5 w-5">
                            {pipeline.updatedBy?.image && <AvatarImage src={pipeline.updatedBy.image} alt={pipeline.updatedBy.name ?? ""} />}
                            <AvatarFallback className="text-[10px]">{getUserInitials(pipeline.updatedBy)}</AvatarFallback>
                          </Avatar>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{pipeline.updatedBy?.name ?? pipeline.updatedBy?.email ?? "Unknown"}</TooltipContent>
                    </Tooltip>
                    <span className="text-sm text-muted-foreground">
                      {new Date(pipeline.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
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
                        onClick={() => setPromoteTarget({
                          id: pipeline.id,
                          name: pipeline.name,
                          environmentId: effectiveEnvId,
                        })}
                      >
                        <ArrowUpRight className="mr-2 h-4 w-4" />
                        Promote to...
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

      {promoteTarget && (
        <PromotePipelineDialog
          open={!!promoteTarget}
          onOpenChange={(open) => { if (!open) setPromoteTarget(null); }}
          pipeline={promoteTarget}
        />
      )}
    </div>
  );
}
