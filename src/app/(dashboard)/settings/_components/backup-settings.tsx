"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  Download,
  AlertTriangle,
  Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryError } from "@/components/query-error";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success") return <Badge variant="secondary">Success</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline">In progress</Badge>;
}

const TYPE_LABELS: Record<string, string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  pre_restore: "Pre-restore",
};

// ─── Backup Settings ────────────────────────────────────────────────────────────

export function BackupSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const backupsQuery = useQuery(trpc.settings.listBackups.queryOptions());

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCron, setScheduleCron] = useState("0 2 * * *");
  const [retentionCount, setRetentionCount] = useState(7);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    if (settingsQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScheduleEnabled(settingsQuery.data.backupEnabled ?? false);
      setScheduleCron(settingsQuery.data.backupCron ?? "0 2 * * *");
      setRetentionCount(settingsQuery.data.backupRetentionCount ?? 7);
    }
  }, [settingsQuery.data]);

  const createBackupMutation = useMutation(
    trpc.settings.createBackup.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.listBackups.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Backup created successfully");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create backup");
      },
    }),
  );

  const deleteBackupMutation = useMutation(
    trpc.settings.deleteBackup.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.listBackups.queryKey() });
        setDeleteTarget(null);
        toast.success("Backup deleted");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete backup");
      },
    }),
  );

  const restoreBackupMutation = useMutation(
    trpc.settings.restoreBackup.mutationOptions({
      onSuccess: () => {
        setRestoreTarget(null);
        toast.success("Backup restored successfully. Please restart the application.");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to restore backup");
      },
    }),
  );

  const updateScheduleMutation = useMutation(
    trpc.settings.updateBackupSchedule.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Backup schedule updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update backup schedule");
      },
    }),
  );

  if (settingsQuery.isError) return <QueryError message="Failed to load backup settings" onRetry={() => settingsQuery.refetch()} />;

  return (
    <div className="space-y-6">
      {/* Backup Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Backup Schedule
          </CardTitle>
          <CardDescription>
            Configure automatic database backups on a schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="backup-schedule-toggle">Enable scheduled backups</Label>
            <Switch
              id="backup-schedule-toggle"
              checked={scheduleEnabled}
              onCheckedChange={setScheduleEnabled}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Schedule</Label>
              <Select value={scheduleCron} onValueChange={setScheduleCron}>
                <SelectTrigger>
                  <SelectValue placeholder="Select schedule" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0 */12 * * *">Every 12 hours</SelectItem>
                  <SelectItem value="0 2 * * *">Daily at 2:00 AM</SelectItem>
                  <SelectItem value="0 2 * * 0">Weekly (Sunday 2:00 AM)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Retention (keep last N backups)</Label>
              <Select
                value={String(retentionCount)}
                onValueChange={(v) => setRetentionCount(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select retention" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                  <SelectItem value="14">14</SelectItem>
                  <SelectItem value="30">30</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={() =>
              updateScheduleMutation.mutate({
                enabled: scheduleEnabled,
                cron: scheduleCron,
                retentionCount,
              })
            }
            disabled={updateScheduleMutation.isPending}
          >
            {updateScheduleMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save Schedule
          </Button>
        </CardContent>
      </Card>

      {/* Failed Backup Alert — reads from most recent BackupRecord (single source of truth) */}
      {backupsQuery.data?.[0]?.status === "failed" && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium text-destructive">Last backup failed</p>
              <p className="text-muted-foreground">
                {backupsQuery.data[0].error || "Unknown error"} &mdash;{" "}
                {formatRelativeTime(backupsQuery.data[0].startedAt)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Backup */}
      <Card>
        <CardHeader>
          <CardTitle>Manual Backup</CardTitle>
          <CardDescription>
            Create an on-demand backup of the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
          >
            {createBackupMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Create Backup Now
          </Button>
          {backupsQuery.data?.[0] && (
            <p className="text-sm text-muted-foreground">
              Last backup: {formatRelativeTime(backupsQuery.data[0].startedAt)}
              {backupsQuery.data[0].status && (
                <> &mdash; {backupsQuery.data[0].status}</>
              )}
              {backupsQuery.data[0].status === "failed" && backupsQuery.data[0].error && (
                <span className="text-destructive"> ({backupsQuery.data[0].error})</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Available Backups */}
      <Card>
        <CardHeader>
          <CardTitle>Available Backups</CardTitle>
          <CardDescription>
            Manage existing database backups. You can restore or delete them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {backupsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !backupsQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">No backups found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backupsQuery.data.map((backup) => (
                  <TableRow key={backup.filename}>
                    <TableCell className="tabular-nums">
                      {new Date(backup.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {TYPE_LABELS[backup.type] ?? backup.type}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={backup.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatBytes(Number(backup.sizeBytes ?? 0))}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDuration(backup.durationMs)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                        >
                          <a
                            href={`/api/backups/${encodeURIComponent(backup.filename)}/download`}
                            download
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRestoreTarget(backup.filename)}
                        >
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(backup.filename)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Warning Banner */}
      <Card className="border-status-degraded/30">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-degraded-foreground" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Important</p>
            <p>
              Database backups do not include your <code>.env</code> file or
              encryption secrets. Make sure to keep those backed up separately in
              a secure location.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Restore Confirmation Dialog */}
      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        title="Restore from backup?"
        description="This will overwrite the current database with the selected backup. This action cannot be undone. The application should be restarted after restoring."
        confirmLabel="Restore"
        variant="destructive"
        isPending={restoreBackupMutation.isPending}
        onConfirm={() => {
          if (restoreTarget) {
            restoreBackupMutation.mutate({ filename: restoreTarget });
          }
        }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete backup?"
        description="This will permanently delete the selected backup file. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteBackupMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteBackupMutation.mutate({ filename: deleteTarget });
          }
        }}
      />
    </div>
  );
}
