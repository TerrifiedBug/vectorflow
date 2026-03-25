"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  RotateCcw,
  Loader2,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { VersionTimeline } from "@/components/pipeline/version-timeline";

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

  // Track which version ID is currently being fetched for loading state
  const [fetchingVersionId, setFetchingVersionId] = useState<string | null>(null);

  const pipelineQuery = useQuery({
    ...trpc.pipeline.get.queryOptions({ id: pipelineId }),
    enabled: open,
  });

  // Use the lightweight summary query instead of full versions
  const versionsQuery = useQuery({
    ...trpc.pipeline.versionsSummary.queryOptions({ pipelineId }),
    enabled: open,
  });

  const rollbackMutation = useMutation(
    trpc.pipeline.rollback.mutationOptions({
      onSuccess: (newVersion) => {
        toast.success(`Rolled back to version ${newVersion.version}`);
        setRollbackTarget(null);
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.versionsSummary.queryKey({ pipelineId }),
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

  const isLoading = pipelineQuery.isLoading || versionsQuery.isLoading;
  const versions = versionsQuery.data ?? [];
  const latestVersion = versions.length > 0 ? versions[0] : null;

  /**
   * Lazily fetch full version config for View or Rollback actions.
   * Uses React Query's queryClient.fetchQuery to leverage caching — if
   * the version was already fetched, it returns instantly from cache.
   */
  const fetchVersionConfig = async (versionId: string) => {
    return queryClient.fetchQuery(
      trpc.pipeline.getVersion.queryOptions({ versionId }),
    );
  };

  /** Handle View click: fetch the clicked version + compare target, then show diff */
  const handleView = async (versionId: string) => {
    setFetchingVersionId(versionId);
    try {
      const clickedVersion = await fetchVersionConfig(versionId);
      const isCurrent = latestVersion?.id === versionId;

      if (isCurrent) {
        // Current version: compare against the previous version
        const idx = versions.findIndex((v) => v.id === versionId);
        const prevSummary = idx < versions.length - 1 ? versions[idx + 1] : null;
        let compareYaml: string | null = null;
        let compareLabel = "";
        if (prevSummary) {
          const prevVersion = await fetchVersionConfig(prevSummary.id);
          compareYaml = prevVersion.configYaml;
          compareLabel = `v${prevSummary.version}`;
        }
        setViewingConfig({
          version: clickedVersion.version,
          yaml: clickedVersion.configYaml,
          compareYaml,
          compareLabel,
        });
      } else {
        // Non-current version: compare against the current (latest) version
        let compareYaml: string | null = null;
        let compareLabel = "";
        if (latestVersion) {
          const latestFull = await fetchVersionConfig(latestVersion.id);
          compareYaml = latestFull.configYaml;
          compareLabel = `v${latestVersion.version} (current)`;
        }
        setViewingConfig({
          version: clickedVersion.version,
          yaml: clickedVersion.configYaml,
          compareYaml,
          compareLabel,
        });
      }
    } catch {
      toast.error("Failed to load version config");
    } finally {
      setFetchingVersionId(null);
    }
  };

  /** Handle Rollback click: fetch the target version config, then show confirmation */
  const handleRollbackClick = async (versionId: string) => {
    setFetchingVersionId(versionId);
    try {
      const targetVersion = await fetchVersionConfig(versionId);
      setRollbackTarget({
        id: targetVersion.id,
        version: targetVersion.version,
        yaml: targetVersion.configYaml,
      });
    } catch {
      toast.error("Failed to load version config");
    } finally {
      setFetchingVersionId(null);
    }
  };

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
              <VersionTimeline
                versions={versions}
                currentVersionId={latestVersion?.id ?? null}
                onView={handleView}
                onRollback={handleRollbackClick}
                isRollbackPending={
                  rollbackMutation.isPending || fetchingVersionId !== null
                }
              />
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
            <RollbackDiffContent
              rollbackYaml={rollbackTarget.yaml}
              latestVersionId={latestVersion.id}
              latestVersionNumber={latestVersion.version}
              rollbackVersionNumber={rollbackTarget.version}
              fetchVersionConfig={fetchVersionConfig}
            />
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

/**
 * Sub-component for the rollback diff content. It needs the current version's
 * configYaml, which must be lazily fetched since we're now using versionsSummary.
 */
function RollbackDiffContent({
  rollbackYaml,
  latestVersionId,
  latestVersionNumber,
  rollbackVersionNumber,
  fetchVersionConfig,
}: {
  rollbackYaml: string;
  latestVersionId: string;
  latestVersionNumber: number;
  rollbackVersionNumber: number;
  fetchVersionConfig: (versionId: string) => Promise<{ configYaml: string }>;
}) {
  const latestQuery = useQuery({
    queryKey: ["version-config", latestVersionId],
    queryFn: () => fetchVersionConfig(latestVersionId),
  });

  if (latestQuery.isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentYaml = latestQuery.data?.configYaml ?? "";

  return (
    <ScrollArea className="h-[400px] rounded-md border bg-muted/30">
      {rollbackYaml === currentYaml ? (
        <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
          No differences — configs are identical.
        </div>
      ) : (
        <ConfigDiff
          oldConfig={currentYaml}
          newConfig={rollbackYaml}
          oldLabel={`v${latestVersionNumber} (current)`}
          newLabel={`v${rollbackVersionNumber} (rollback target)`}
          className="p-4 text-xs font-mono leading-5"
        />
      )}
    </ScrollArea>
  );
}
