"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  Clock,
  RotateCcw,
  Eye,
  Loader2,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfigDiff } from "@/components/ui/config-diff";

interface VersionHistoryDialogProps {
  pipelineId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistoryDialog({
  pipelineId,
  open,
  onOpenChange,
}: VersionHistoryDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [viewingConfig, setViewingConfig] = useState<{
    version: number;
    yaml: string;
    compareYaml: string | null;
    compareLabel: string;
  } | null>(null);

  const [rollbackTarget, setRollbackTarget] = useState<{
    id: string;
    version: number;
    yaml: string;
  } | null>(null);

  const pipelineQuery = useQuery({
    ...trpc.pipeline.get.queryOptions({ id: pipelineId }),
    enabled: open,
  });

  const versionsQuery = useQuery({
    ...trpc.pipeline.versions.queryOptions({ pipelineId }),
    enabled: open,
  });

  const rollbackMutation = useMutation(
    trpc.pipeline.rollback.mutationOptions({
      onSuccess: (newVersion) => {
        toast.success(`Rolled back to version ${newVersion.version}`);
        setRollbackTarget(null);
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.versions.queryKey({ pipelineId }),
        });
      },
      onError: (err) => {
        toast.error(err.message || "Rollback failed");
      },
    }),
  );

  const handleRollback = () => {
    if (!rollbackTarget) return;
    rollbackMutation.mutate({
      pipelineId,
      targetVersionId: rollbackTarget.id,
    });
  };

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isLoading = pipelineQuery.isLoading || versionsQuery.isLoading;
  const versions = versionsQuery.data ?? [];
  const latestVersion = versions.length > 0 ? versions[0] : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && rollbackMutation.isPending) return;
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              {pipelineQuery.data?.name} — {versions.length} version
              {versions.length !== 1 ? "s" : ""}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex h-[200px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Tag className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-4 text-sm text-muted-foreground">
                No versions yet. Deploy your pipeline to create the first
                version.
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1 min-h-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Version</TableHead>
                    <TableHead>Changelog</TableHead>
                    <TableHead className="w-[180px]">Created</TableHead>
                    <TableHead className="w-[120px] text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => {
                    const isCurrent = latestVersion?.id === version.id;
                    return (
                      <TableRow key={version.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">
                              v{version.version}
                            </span>
                            {isCurrent && (
                              <Badge
                                variant="secondary"
                                className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-xs"
                              >
                                Current
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {version.changelog || "No changelog"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDate(version.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="View changes"
                              aria-label="View changes"
                              onClick={() => {
                                if (isCurrent) {
                                  const idx = versions.findIndex(
                                    (v) => v.id === version.id,
                                  );
                                  const prev =
                                    idx < versions.length - 1
                                      ? versions[idx + 1]
                                      : null;
                                  setViewingConfig({
                                    version: version.version,
                                    yaml: version.configYaml,
                                    compareYaml: prev?.configYaml ?? null,
                                    compareLabel: prev
                                      ? `v${prev.version}`
                                      : "",
                                  });
                                } else {
                                  setViewingConfig({
                                    version: version.version,
                                    yaml: version.configYaml,
                                    compareYaml:
                                      latestVersion?.configYaml ?? null,
                                    compareLabel: latestVersion
                                      ? `v${latestVersion.version} (current)`
                                      : "",
                                  });
                                }
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!isCurrent && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Rollback to this version"
                                aria-label="Rollback to this version"
                                disabled={rollbackMutation.isPending}
                                onClick={() =>
                                  setRollbackTarget({
                                    id: version.id,
                                    version: version.version,
                                    yaml: version.configYaml,
                                  })
                                }
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Config Viewer Dialog */}
      <Dialog
        open={viewingConfig !== null}
        onOpenChange={(next) => {
          if (!next) setViewingConfig(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Version {viewingConfig?.version}{" "}
              {viewingConfig?.compareYaml !== null
                ? "Changes"
                : "Configuration"}
            </DialogTitle>
            <DialogDescription>
              {viewingConfig?.compareYaml !== null
                ? `Diff between v${viewingConfig?.version} and ${viewingConfig?.compareLabel}`
                : "Full YAML configuration for the initial version"}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px] rounded-md border bg-muted/30">
            {viewingConfig && viewingConfig.compareYaml !== null ? (
              viewingConfig.yaml === viewingConfig.compareYaml ? (
                <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
                  No differences — configs are identical.
                </div>
              ) : (
                <ConfigDiff
                  oldConfig={viewingConfig.compareYaml}
                  newConfig={viewingConfig.yaml}
                  oldLabel={viewingConfig.compareLabel}
                  newLabel={`v${viewingConfig.version}`}
                  className="p-4 text-xs font-mono leading-5"
                />
              )
            ) : (
              <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                {viewingConfig?.yaml}
              </pre>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation Dialog with Diff */}
      <Dialog
        open={rollbackTarget !== null}
        onOpenChange={(next) => {
          if (!next && !rollbackMutation.isPending) setRollbackTarget(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Rollback to v{rollbackTarget?.version}
            </DialogTitle>
            <DialogDescription>
              Review the changes that will be applied. This creates a new version
              with the target config — no history is lost.
            </DialogDescription>
          </DialogHeader>

          {rollbackTarget && latestVersion && (
            <ScrollArea className="h-[400px] rounded-md border bg-muted/30">
              {rollbackTarget.yaml === latestVersion.configYaml ? (
                <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
                  No differences — configs are identical.
                </div>
              ) : (
                <ConfigDiff
                  oldConfig={latestVersion.configYaml}
                  newConfig={rollbackTarget.yaml}
                  oldLabel={`v${latestVersion.version} (current)`}
                  newLabel={`v${rollbackTarget.version} (rollback target)`}
                  className="p-4 text-xs font-mono leading-5"
                />
              )}
            </ScrollArea>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRollbackTarget(null)}
              disabled={rollbackMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRollback}
              disabled={rollbackMutation.isPending}
            >
              {rollbackMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rolling back...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Confirm Rollback
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
