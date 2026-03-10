"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Copy, Trash2, BarChart3, ArrowUpRight, Clock, AlertTriangle } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PromotePipelineDialog } from "@/components/promote-pipeline-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/page-header";
import { formatEventsRate, formatBytesRate } from "@/lib/format";
import { tagBadgeClass, reductionBadgeClass } from "@/lib/badge-variants";

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


function PipelineHealthBadge({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const healthQuery = useQuery(
    trpc.pipeline.health.queryOptions(
      { pipelineId },
      { refetchInterval: 30_000 },
    ),
  );
  const status = healthQuery.data?.status ?? null;
  const hasSlis = (healthQuery.data?.slis?.length ?? 0) > 0;

  if (!status) return null;

  if (status === "no_data" && hasSlis) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
        </TooltipTrigger>
        <TooltipContent>No Data — SLIs configured but no traffic yet</TooltipContent>
      </Tooltip>
    );
  }

  if (status === "no_data") return null;

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

  // Fetch pending deploy requests for the current environment
  const pendingRequestsQuery = useQuery(
    trpc.deploy.listPendingRequests.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId }
    )
  );
  const pendingRequests = pendingRequestsQuery.data ?? [];
  const pendingByPipeline = new Map<string, number>();
  for (const req of pendingRequests) {
    pendingByPipeline.set(req.pipelineId, (pendingByPipeline.get(req.pipelineId) ?? 0) + 1);
  }

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
    <div className="space-y-2">
      <PageHeader
        title="Pipelines"
        actions={
          <Button asChild size="sm">
            <Link href="/pipelines/new">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Pipeline
            </Link>
          </Button>
        }
      />

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
              <TableHead>Labels</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Health</TableHead>
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
              <TableRow key={pipeline.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link
                    href={`/pipelines/${pipeline.id}`}
                    className="hover:underline"
                  >
                    {pipeline.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {(() => {
                    const tags = (pipeline.tags as string[]) ?? [];
                    if (tags.length === 0) return null;
                    if (tags.length === 1) {
                      return (
                        <Badge variant="outline" size="sm" className={tagBadgeClass(tags[0])}>
                          {tags[0]}
                        </Badge>
                      );
                    }
                    return (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="cursor-pointer rounded-md hover:bg-muted/50 px-1 py-0.5 transition-colors">
                            <Badge variant="secondary" size="sm">
                              {tags.length} labels
                            </Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3" align="start">
                          <p className="mb-2 text-sm font-medium">Labels</p>
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map((tag) => (
                              <Badge key={tag} variant="outline" size="sm" className={tagBadgeClass(tag)}>
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    );
                  })()}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                      </TooltipTrigger>
                      <TooltipContent>Undeployed changes</TooltipContent>
                    </Tooltip>
                  )}
                  {pendingByPipeline.has(pipeline.id) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      </TooltipTrigger>
                      <TooltipContent>Pending Approval</TooltipContent>
                    </Tooltip>
                  )}
                  {pipeline.hasStaleComponents && (
                    <Badge
                      variant="secondary"
                      className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      title={`Updates available for: ${pipeline.staleComponentNames?.join(", ")}`}
                    >
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Updates available
                    </Badge>
                  )}
                  </div>
                </TableCell>
                {/* Health */}
                <TableCell className="text-center">
                  {pipeline.isDraft ? (
                    <span className="text-sm text-muted-foreground">--</span>
                  ) : (
                    <PipelineHealthBadge pipelineId={pipeline.id} />
                  )}
                </TableCell>
                {/* Events/sec In */}
                <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {liveRates[pipeline.id]
                    ? formatEventsRate(liveRates[pipeline.id].eventsPerSec)
                    : "—"}
                </TableCell>
                {/* Bytes/sec In */}
                <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {liveRates[pipeline.id]
                    ? formatBytesRate(liveRates[pipeline.id].bytesPerSec)
                    : "—"}
                </TableCell>
                {/* Reduction */}
                <TableCell className="text-right tabular-nums">
                  {(() => {
                    const pct = totals ? getReductionPercent(totals) : null;
                    if (pct == null) return <span className="text-sm text-muted-foreground">—</span>;
                    return (
                      <Badge variant="outline" className={reductionBadgeClass(pct)}>
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
