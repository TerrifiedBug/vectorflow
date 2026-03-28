"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface GitSyncStatusProps {
  environmentId: string;
}

export function GitSyncStatus({ environmentId }: GitSyncStatusProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const statusQuery = useQuery(
    trpc.gitSync.status.queryOptions({ environmentId }),
  );

  const jobsQuery = useQuery(
    trpc.gitSync.jobs.queryOptions({ environmentId, limit: 10 }),
  );

  const importErrorsQuery = useQuery(
    trpc.gitSync.importErrors.queryOptions({ environmentId, limit: 5 }),
  );

  const retryAllMutation = useMutation(
    trpc.gitSync.retryAllFailed.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Queued ${data.retriedCount} job(s) for retry`);
        queryClient.invalidateQueries({ queryKey: trpc.gitSync.status.queryKey({ environmentId }) });
        queryClient.invalidateQueries({ queryKey: trpc.gitSync.jobs.queryKey({ environmentId }) });
      },
      onError: (err) => toast.error(err.message, { duration: 6000 }),
    }),
  );

  const retryJobMutation = useMutation(
    trpc.gitSync.retryJob.mutationOptions({
      onSuccess: () => {
        toast.success("Job queued for retry");
        queryClient.invalidateQueries({ queryKey: trpc.gitSync.status.queryKey({ environmentId }) });
        queryClient.invalidateQueries({ queryKey: trpc.gitSync.jobs.queryKey({ environmentId }) });
      },
      onError: (err) => toast.error(err.message, { duration: 6000 }),
    }),
  );

  const status = statusQuery.data;

  if (statusQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading sync status...
        </CardContent>
      </Card>
    );
  }

  if (!status || status.gitOpsMode === "off") {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Status Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Git Sync Status
            {status.failedCount > 0 ? (
              <Badge variant="destructive">{status.failedCount} failed</Badge>
            ) : status.pendingCount > 0 ? (
              <Badge variant="secondary">{status.pendingCount} pending</Badge>
            ) : (
              <Badge variant="outline" className="text-green-600 border-green-300">
                Healthy
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Provider: {status.gitProvider ?? "auto-detected"} | Branch: {status.gitBranch ?? "main"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">Last successful sync:</span>
              <span>
                {status.lastSuccessfulSync
                  ? new Date(status.lastSuccessfulSync).toLocaleString()
                  : "Never"}
              </span>
            </div>
            {status.lastError && (
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-muted-foreground">Last error:</span>
                <span className="text-destructive truncate max-w-[300px]" title={status.lastError}>
                  {status.lastError}
                </span>
              </div>
            )}
          </div>

          {status.failedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => retryAllMutation.mutate({ environmentId })}
              disabled={retryAllMutation.isPending}
            >
              {retryAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Retry all failed
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Recent Jobs Table */}
      {jobsQuery.data && jobsQuery.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sync Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobsQuery.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">
                      {job.pipeline.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{job.action}</Badge>
                    </TableCell>
                    <TableCell>
                      {job.status === "completed" && (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-3 w-3" /> Completed
                        </span>
                      )}
                      {job.status === "pending" && (
                        <span className="flex items-center gap-1 text-yellow-600">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      )}
                      {job.status === "failed" && (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Failed
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{job.attempts}/{job.maxAttempts}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(job.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {job.status === "failed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => retryJobMutation.mutate({ jobId: job.id })}
                          disabled={retryJobMutation.isPending}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Import Errors */}
      {importErrorsQuery.data && importErrorsQuery.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Git Import Errors
            </CardTitle>
            <CardDescription>
              YAML import failures from webhook events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {importErrorsQuery.data.map((entry) => {
                const meta = entry.metadata as Record<string, unknown> | null;
                return (
                  <div
                    key={entry.id}
                    className="rounded border p-3 text-sm space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">
                        {(meta?.file as string) ?? "unknown file"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-destructive text-xs">
                      {(meta?.error as string) ?? "Unknown error"}
                    </p>
                    {meta?.commitRef && (
                      <p className="text-xs text-muted-foreground">
                        Commit: {String(meta.commitRef).slice(0, 8)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
