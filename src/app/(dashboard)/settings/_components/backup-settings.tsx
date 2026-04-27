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
  Cloud,
  HardDrive,
  PlugZap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { DemoDisabledNotice, DemoDisabledFieldset, DemoDisabledBadge } from "@/components/demo-disabled";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryError } from "@/components/query-error";
import { RestoreDialog } from "./RestoreDialog";

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
  if (status === "orphaned") return <Badge variant="outline" className="text-muted-foreground">Orphaned</Badge>;
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

  // Storage backend form state
  const [storageBackend, setStorageBackend] = useState<"local" | "s3">("local");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Prefix, setS3Prefix] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");

  useEffect(() => {
    if (settingsQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScheduleEnabled(settingsQuery.data.backupEnabled ?? false);
      setScheduleCron(settingsQuery.data.backupCron ?? "0 2 * * *");
      setRetentionCount(settingsQuery.data.backupRetentionCount ?? 7);
      setStorageBackend((settingsQuery.data.backupStorageBackend as "local" | "s3") ?? "local");
      setS3Bucket(settingsQuery.data.s3Bucket ?? "");
      setS3Region(settingsQuery.data.s3Region ?? "us-east-1");
      setS3Prefix(settingsQuery.data.s3Prefix ?? "");
      setS3AccessKeyId(settingsQuery.data.s3AccessKeyId ?? "");
      setS3SecretAccessKey(""); // Never pre-fill secret -- display masked value as placeholder
      setS3Endpoint(settingsQuery.data.s3Endpoint ?? "");
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
        toast.error(error.message || "Failed to create backup", { duration: 6000 });
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
        toast.error(error.message || "Failed to delete backup", { duration: 6000 });
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
        toast.error(error.message || "Failed to update backup schedule", { duration: 6000 });
      },
    }),
  );

  const testS3Mutation = useMutation(
    trpc.settings.testS3Connection.mutationOptions({
      onSuccess: () => {
        toast.success("S3 connection successful");
      },
      onError: (error) => {
        toast.error(error.message || "S3 connection test failed", { duration: 6000 });
      },
    }),
  );

  const updateStorageBackendMutation = useMutation(
    trpc.settings.updateStorageBackend.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("Storage backend updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update storage backend", { duration: 6000 });
      },
    }),
  );

  // Download via fetch + blob so we can render JSON errors as toasts instead of
  // letting the browser save the error body as `download.txt`.
  async function handleDownload(filename: string) {
    try {
      const res = await fetch(`/api/backups/${encodeURIComponent(filename)}/download`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || `Download failed (${res.status})`, { duration: 6000 });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed", { duration: 6000 });
    }
  }

  if (settingsQuery.isError) return <QueryError message="Failed to load backup settings" onRetry={() => settingsQuery.refetch()} />;
  if (backupsQuery.isError) return <QueryError message="Failed to load backup history" onRetry={() => backupsQuery.refetch()} />;

  return (
    <div className="space-y-6">
      <DemoDisabledNotice message="Backup creation, restore, and S3 storage configuration are disabled in the public demo. The buttons and inputs below are read-only." />
      <DemoDisabledFieldset>
      {/* Storage Backend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Storage Backend
            <DemoDisabledBadge className="ml-auto" />
          </CardTitle>
          <CardDescription>
            Choose where backup files are stored. S3-compatible storage works with AWS S3, MinIO, DigitalOcean Spaces, and Backblaze B2.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex rounded-lg border p-1">
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                storageBackend === "local"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setStorageBackend("local")}
            >
              <HardDrive className="h-4 w-4" />
              Local
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                storageBackend === "s3"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setStorageBackend("s3")}
            >
              <Cloud className="h-4 w-4" />
              S3
            </button>
          </div>

          {storageBackend === "s3" && (
            <div className="space-y-4 rounded-md border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="s3-bucket">Bucket *</Label>
                  <Input
                    id="s3-bucket"
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                    placeholder="my-backup-bucket"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="s3-region">Region *</Label>
                  <Input
                    id="s3-region"
                    value={s3Region}
                    onChange={(e) => setS3Region(e.target.value)}
                    placeholder="us-east-1"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="s3-prefix">Prefix</Label>
                  <Input
                    id="s3-prefix"
                    value={s3Prefix}
                    onChange={(e) => setS3Prefix(e.target.value)}
                    placeholder="backups/vectorflow"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="s3-endpoint">Endpoint URL</Label>
                  <Input
                    id="s3-endpoint"
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                    placeholder="https://minio.example.com:9000"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="s3-access-key">Access Key ID *</Label>
                  <Input
                    id="s3-access-key"
                    value={s3AccessKeyId}
                    onChange={(e) => setS3AccessKeyId(e.target.value)}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="s3-secret-key">Secret Access Key *</Label>
                  <Input
                    id="s3-secret-key"
                    type="password"
                    value={s3SecretAccessKey}
                    onChange={(e) => setS3SecretAccessKey(e.target.value)}
                    placeholder={settingsQuery.data?.s3SecretAccessKey ? "Saved (enter new to change)" : "Enter secret access key"}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    testS3Mutation.mutate({
                      bucket: s3Bucket,
                      region: s3Region,
                      prefix: s3Prefix,
                      accessKeyId: s3AccessKeyId,
                      secretAccessKey: s3SecretAccessKey,
                      endpoint: s3Endpoint || undefined,
                    })
                  }
                  disabled={testS3Mutation.isPending || !s3Bucket || !s3Region || !s3AccessKeyId || !s3SecretAccessKey}
                >
                  {testS3Mutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PlugZap className="mr-2 h-4 w-4" />
                  )}
                  Test Connection
                </Button>
              </div>
            </div>
          )}

          <Button
            onClick={() =>
              updateStorageBackendMutation.mutate({
                backend: storageBackend,
                bucket: s3Bucket,
                region: s3Region,
                prefix: s3Prefix,
                accessKeyId: s3AccessKeyId,
                secretAccessKey: s3SecretAccessKey || "unchanged",
                endpoint: s3Endpoint,
              })
            }
            disabled={updateStorageBackendMutation.isPending}
          >
            {updateStorageBackendMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save Storage Settings
          </Button>
        </CardContent>
      </Card>

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
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !backupsQuery.data?.length ? (
            <EmptyState icon={HardDrive} title="No backups yet" description="Create a backup to get started." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Storage</TableHead>
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
                    <TableCell>
                      {backup.storageLocation?.startsWith("s3://") ? (
                        <Cloud className="h-4 w-4 text-muted-foreground" aria-label="S3" />
                      ) : (
                        <HardDrive className="h-4 w-4 text-muted-foreground" aria-label="Local" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {backup.status === "success" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDownload(backup.filename)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setRestoreTarget(backup.filename)}
                            >
                              Restore
                            </Button>
                          </>
                        )}
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
      </DemoDisabledFieldset>

      {/* Restore Dialog */}
      <RestoreDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        filename={restoreTarget ?? ""}
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
