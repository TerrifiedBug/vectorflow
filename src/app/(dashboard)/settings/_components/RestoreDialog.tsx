"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "preview" | "confirm" | "executing" | "done" | "error";

interface RestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── RestoreDialog ────────────────────────────────────────────────────────────

export function RestoreDialog({ open, onOpenChange, filename }: RestoreDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("preview");
  const [confirmText, setConfirmText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleClose = (openState: boolean) => {
    if (!openState && step !== "executing") {
      setStep("preview");
      setConfirmText("");
      setErrorMessage("");
    }
    if (step !== "executing") {
      onOpenChange(openState);
    }
  };

  const previewQuery = useQuery(
    trpc.settings.previewBackup.queryOptions(
      { filename },
      { enabled: open && step === "preview" && !!filename }
    )
  );

  const restoreMutation = useMutation(
    trpc.settings.restoreBackup.mutationOptions({
      onSuccess: () => {
        setStep("done");
        queryClient.invalidateQueries({ queryKey: trpc.settings.listBackups.queryKey() });
      },
      onError: (error) => {
        setErrorMessage(error.message || "Restore failed unexpectedly");
        setStep("error");
      },
    })
  );

  const canConfirm = confirmText === "RESTORE";

  // ─── Step: preview ───────────────────────────────────────────────────────────

  if (step === "preview") {
    const data = previewQuery.data;

    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Preview</DialogTitle>
            <DialogDescription>Review the backup contents before restoring.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {previewQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : previewQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="text-sm text-destructive">
                    <p className="font-medium">Failed to load preview</p>
                    <p className="mt-1">{previewQuery.error?.message ?? "Unknown error"}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => previewQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : data ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-muted-foreground">VectorFlow Version</span>
                  <span className="font-medium">{data.vfVersion}</span>

                  <span className="text-muted-foreground">Migration Level</span>
                  <span className="font-medium">
                    {data.migrationCount} migrations
                    {data.lastMigration ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}(last: {data.lastMigration})
                      </span>
                    ) : null}
                  </span>

                  <span className="text-muted-foreground">PostgreSQL Version</span>
                  <span className="font-medium">{data.pgVersion}</span>

                  <span className="text-muted-foreground">Backup Size</span>
                  <span className="font-medium">{formatBytes(data.sizeBytes)}</span>

                  <span className="text-muted-foreground">Created At</span>
                  <span className="font-medium">
                    {new Date(data.startedAt).toLocaleString()}
                  </span>

                  <span className="text-muted-foreground">Tables Present</span>
                  <span className="font-medium">
                    {data.tablesPresent.length} tables in dump
                  </span>
                </div>
                {data.tablesPresent.length > 0 && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {data.tablesPresent.join(", ")}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button
              disabled={!data || previewQuery.isLoading}
              onClick={() => setStep("confirm")}
            >
              Continue to Confirmation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Step: confirm ───────────────────────────────────────────────────────────

  if (step === "confirm") {
    const previewData = previewQuery.data;
    const backupDate = previewData
      ? new Date(previewData.startedAt).toLocaleString()
      : filename;

    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Restore</DialogTitle>
            <DialogDescription>
              This action will permanently replace the current database.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">
                  This will overwrite the current database with the backup from{" "}
                  <strong>{backupDate}</strong>. This action cannot be undone. A safety backup
                  will be created automatically before restoring.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="restore-confirm-input">
                Type <strong>RESTORE</strong> to confirm
              </Label>
              <Input
                id="restore-confirm-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESTORE"
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("preview")}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={!canConfirm}
              onClick={() => {
                setStep("executing");
                restoreMutation.mutate({ filename });
              }}
            >
              Restore Database
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Step: executing ─────────────────────────────────────────────────────────

  if (step === "executing") {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Restoring Database...</DialogTitle>
            <DialogDescription>
              Creating safety backup and applying restore. Do not close this window.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Step: done ──────────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Complete</DialogTitle>
          </DialogHeader>

          <div className="rounded-md border border-green-500/30 bg-green-500/10 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
              <div className="text-sm text-green-800 dark:text-green-300">
                <p className="font-medium">Database restored successfully</p>
                <p className="mt-1">
                  Please restart the application for changes to take full effect.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => handleClose(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Step: error ─────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore Failed</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="text-sm text-destructive">
                <p className="font-medium">Restore failed</p>
                <p className="mt-1">{errorMessage}</p>
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            The safety backup was created before the restore attempt. If needed, contact your
            administrator for recovery assistance.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => handleClose(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
