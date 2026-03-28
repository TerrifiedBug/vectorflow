"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Loader2,
  Rocket,
  RotateCcw,
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
import { VersionTimeline, type SelectedVersions } from "@/components/pipeline/version-timeline";
import { VersionDiffViewer } from "@/components/pipeline/version-diff-viewer";
import type { NodeSnapshot, EdgeSnapshot } from "@/lib/version-diff";

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

  // Deploy-from-version state — includes snapshots for diff preview
  const [deployTarget, setDeployTarget] = useState<{
    id: string;
    version: number;
    configYaml: string;
    nodesSnapshot: unknown;
    edgesSnapshot: unknown;
    currentConfigYaml: string;
    currentVersion: number;
    currentNodesSnapshot: unknown;
    currentEdgesSnapshot: unknown;
  } | null>(null);

  // Track which version ID is currently being fetched for loading state
  const [fetchingVersionId, setFetchingVersionId] = useState<string | null>(null);

  // ── Compare mode state ───────────────────────────────────────────
  const [compareMode, setCompareMode] = useState(false);
  const [selectedVersions, setSelectedVersions] = useState<SelectedVersions>({
    a: null,
    b: null,
  });
  const [comparingVersions, setComparingVersions] = useState<{
    versionA: {
      version: number;
      configYaml: string;
      nodesSnapshot: unknown;
      edgesSnapshot: unknown;
    };
    versionB: {
      version: number;
      configYaml: string;
      nodesSnapshot: unknown;
      edgesSnapshot: unknown;
    };
  } | null>(null);
  const [isFetchingCompare, setIsFetchingCompare] = useState(false);

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
        toast.error(err.message || "Rollback failed", { duration: 6000 });
      },
    }),
  );

  const deployFromVersionMutation = useMutation(
    trpc.deploy.deployFromVersion.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Deployed version ${result.version.version}`);
        setDeployTarget(null);
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.versionsSummary.queryKey({ pipelineId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }),
        });
      },
      onError: (err) => {
        toast.error(err.message || "Deploy failed", { duration: 6000 });
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

  /** Handle Deploy click: fetch both target and current version configs, then show confirmation with diff */
  const handleDeployClick = async (versionId: string) => {
    setFetchingVersionId(versionId);
    try {
      const [targetVersion, currentVersion] = await Promise.all([
        fetchVersionConfig(versionId),
        latestVersion ? fetchVersionConfig(latestVersion.id) : null,
      ]);
      if (!currentVersion || !latestVersion) {
        toast.error("Cannot determine current version for comparison", { duration: 6000 });
        return;
      }
      setDeployTarget({
        id: targetVersion.id,
        version: targetVersion.version,
        configYaml: targetVersion.configYaml,
        nodesSnapshot: targetVersion.nodesSnapshot,
        edgesSnapshot: targetVersion.edgesSnapshot,
        currentConfigYaml: currentVersion.configYaml,
        currentVersion: latestVersion.version,
        currentNodesSnapshot: currentVersion.nodesSnapshot,
        currentEdgesSnapshot: currentVersion.edgesSnapshot,
      });
    } catch {
      toast.error("Failed to load version config", { duration: 6000 });
    } finally {
      setFetchingVersionId(null);
    }
  };

  const handleDeployConfirm = () => {
    if (!deployTarget) return;
    deployFromVersionMutation.mutate({
      pipelineId,
      sourceVersionId: deployTarget.id,
      changelog: `Deployed from v${deployTarget.version}`,
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
      toast.error("Failed to load version config", { duration: 6000 });
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
      toast.error("Failed to load version config", { duration: 6000 });
    } finally {
      setFetchingVersionId(null);
    }
  };

  /** Toggle compare mode. Auto-selects sensible defaults when entering. */
  const handleToggleCompareMode = () => {
    if (!compareMode && versions.length >= 2) {
      // Auto-default: A = second-latest (older), B = latest (newer)
      setSelectedVersions({ a: versions[1].id, b: versions[0].id });
    } else {
      setSelectedVersions({ a: null, b: null });
    }
    setCompareMode(!compareMode);
    setComparingVersions(null);
  };

  /** Lazy-fetch both selected versions and open the diff viewer. */
  const handleCompareSelected = async () => {
    if (!selectedVersions.a || !selectedVersions.b) return;
    setIsFetchingCompare(true);
    try {
      const [versionA, versionB] = await Promise.all([
        fetchVersionConfig(selectedVersions.a),
        fetchVersionConfig(selectedVersions.b),
      ]);
      setComparingVersions({ versionA, versionB });
    } catch {
      toast.error("Failed to load versions for comparison", { duration: 6000 });
    } finally {
      setIsFetchingCompare(false);
    }
  };

  const canCompare =
    selectedVersions.a !== null &&
    selectedVersions.b !== null &&
    selectedVersions.a !== selectedVersions.b;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && (rollbackMutation.isPending || deployFromVersionMutation.isPending)) return;
          onOpenChange(next);
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Version History</DialogTitle>
                <DialogDescription>
                  {pipelineQuery.data?.name} — {versions.length} version
                  {versions.length !== 1 ? "s" : ""}
                </DialogDescription>
              </div>
              {versions.length >= 2 && (
                <Button
                  variant={compareMode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={handleToggleCompareMode}
                  className="gap-1.5"
                  title={compareMode ? "Exit compare mode" : "Compare two versions"}
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  {compareMode ? "Exit Compare" : "Compare"}
                </Button>
              )}
            </div>
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
            <>
              <ScrollArea className="flex-1 min-h-0">
                <VersionTimeline
                  versions={versions}
                  currentVersionId={latestVersion?.id ?? null}
                  onView={handleView}
                  onRollback={handleRollbackClick}
                  isRollbackPending={
                    rollbackMutation.isPending || fetchingVersionId !== null
                  }
                  onDeploy={handleDeployClick}
                  isDeployPending={
                    deployFromVersionMutation.isPending || fetchingVersionId !== null
                  }
                  selectable={compareMode}
                  selectedVersions={selectedVersions}
                  onSelectionChange={setSelectedVersions}
                />
              </ScrollArea>
              {compareMode && (
                <div className="flex items-center justify-between border-t pt-3 px-1">
                  <p className="text-xs text-muted-foreground">
                    {selectedVersions.a && selectedVersions.b
                      ? `Comparing v${versions.find((v) => v.id === selectedVersions.a)?.version ?? "?"} → v${versions.find((v) => v.id === selectedVersions.b)?.version ?? "?"}`
                      : "Select version A (old) and B (new) to compare"}
                  </p>
                  <Button
                    size="sm"
                    disabled={!canCompare || isFetchingCompare}
                    onClick={handleCompareSelected}
                  >
                    {isFetchingCompare ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      "Compare Selected"
                    )}
                  </Button>
                </div>
              )}
            </>
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
        <DialogContent className="sm:max-w-3xl">
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
        <DialogContent className="sm:max-w-3xl">
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

      {/* Deploy from Version Confirmation Dialog with Diff Preview */}
      <Dialog
        open={deployTarget !== null}
        onOpenChange={(next) => {
          if (!next && !deployFromVersionMutation.isPending) setDeployTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              Deploy from v{deployTarget?.version}
            </DialogTitle>
            <DialogDescription>
              Review the changes that will be deployed. This creates a new
              version from the selected historical version and pushes it to
              all connected agents.
            </DialogDescription>
          </DialogHeader>

          {deployTarget && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-1">
                <VersionDiffViewer
                  oldYaml={deployTarget.currentConfigYaml}
                  newYaml={deployTarget.configYaml}
                  oldLabel={`v${deployTarget.currentVersion} (current)`}
                  newLabel={`v${deployTarget.version} (deploy target)`}
                  oldNodes={
                    deployTarget.currentNodesSnapshot as
                      | NodeSnapshot[]
                      | null
                  }
                  newNodes={
                    deployTarget.nodesSnapshot as
                      | NodeSnapshot[]
                      | null
                  }
                  oldEdges={
                    deployTarget.currentEdgesSnapshot as
                      | EdgeSnapshot[]
                      | null
                  }
                  newEdges={
                    deployTarget.edgesSnapshot as
                      | EdgeSnapshot[]
                      | null
                  }
                />
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeployTarget(null)}
              disabled={deployFromVersionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeployConfirm}
              disabled={deployFromVersionMutation.isPending}
            >
              {deployFromVersionMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Confirm Deploy
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compare Diff Viewer Dialog */}
      <Dialog
        open={comparingVersions !== null}
        onOpenChange={(next) => {
          if (!next) setComparingVersions(null);
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Version Comparison
            </DialogTitle>
            <DialogDescription>
              {comparingVersions
                ? `Comparing v${comparingVersions.versionA.version} → v${comparingVersions.versionB.version}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {comparingVersions && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-1">
                <VersionDiffViewer
                  oldYaml={comparingVersions.versionA.configYaml}
                  newYaml={comparingVersions.versionB.configYaml}
                  oldLabel={`v${comparingVersions.versionA.version}`}
                  newLabel={`v${comparingVersions.versionB.version}`}
                  oldNodes={
                    comparingVersions.versionA.nodesSnapshot as
                      | NodeSnapshot[]
                      | null
                  }
                  newNodes={
                    comparingVersions.versionB.nodesSnapshot as
                      | NodeSnapshot[]
                      | null
                  }
                  oldEdges={
                    comparingVersions.versionA.edgesSnapshot as
                      | EdgeSnapshot[]
                      | null
                  }
                  newEdges={
                    comparingVersions.versionB.edgesSnapshot as
                      | EdgeSnapshot[]
                      | null
                  }
                />
              </div>
            </ScrollArea>
          )}
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
