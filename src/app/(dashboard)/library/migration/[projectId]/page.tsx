"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  ArrowLeft,
  Play,
  CheckCircle,
  Loader2,
  Download,
  ExternalLink,
  FileText,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

import { MigrationTopology } from "@/components/migration/migration-topology";
import { BlockDetailPanel } from "@/components/migration/block-detail-panel";
import { ConfigViewer } from "@/components/migration/config-viewer";
import { ReadinessBadge } from "@/components/migration/readiness-badge";
import type { ParsedConfig, TranslationResult } from "@/server/services/migration/types";

export default function MigrationProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showOriginalConfig, setShowOriginalConfig] = useState(false);
  const [wasTranslating, setWasTranslating] = useState(false);

  const teamId = selectedTeamId!;

  const projectQuery = useQuery(
    trpc.migration.get.queryOptions(
      { id: projectId, teamId },
      {
        enabled: !!selectedTeamId,
        refetchInterval: (query) => {
          const status = query.state.data?.status;
          if (status === "TRANSLATING") {
            return 2000;
          }
          return false;
        },
      },
    ),
  );

  const project = projectQuery.data;
  const isTranslating = project?.status === "TRANSLATING";

  // Detect translation completion: wasTranslating + no longer translating
  if (wasTranslating && project && !isTranslating) {
    // Runs during render but only sets state (safe in React 19)
    setWasTranslating(false);
    if (project.status === "READY") {
      // Use queueMicrotask to defer the toast out of render
      queueMicrotask(() => toast.success("Translation complete"));
    } else if (project.status === "FAILED") {
      queueMicrotask(() => toast.error(project.errorMessage ?? "Translation failed"));
    }
  }
  const parsedConfig = project?.parsedTopology as unknown as ParsedConfig | null;
  const translationResult = project?.translatedBlocks as unknown as TranslationResult | null;

  const selectedBlock = parsedConfig?.blocks.find((b) => b.id === selectedBlockId) ?? null;
  const selectedTranslation = translationResult?.blocks.find(
    (b) => b.blockId === selectedBlockId,
  ) ?? null;

  const startTranslationMutation = useMutation(
    trpc.migration.startTranslation.mutationOptions(),
  );

  const updateBlockMutation = useMutation(
    trpc.migration.updateBlockConfig.mutationOptions(),
  );

  const validateMutation = useMutation(
    trpc.migration.validate.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: trpc.migration.get.queryKey() });
        if (result.valid) {
          toast.success("Validation passed");
        } else {
          const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
          toast.error(`Validation failed: ${errorCount} error(s)`);
        }
      },
      onError: (err) => {
        toast.error(`Validation error: ${err.message}`);
      },
    }),
  );

  const generateMutation = useMutation(
    trpc.migration.generate.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: trpc.migration.get.queryKey() });
        toast.success("Pipeline generated");
        router.push(`/pipelines/${result.pipelineId}`);
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }),
  );

  const retranslateMutation = useMutation(
    trpc.migration.retranslateBlock.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.migration.get.queryKey() });
        toast.success("Block re-translated");
      },
    }),
  );

  const handleTranslate = () => {
    if (!selectedTeamId) return;
    startTranslationMutation.mutate(
      { id: projectId, teamId },
      {
        onSuccess: () => {
          setWasTranslating(true);
          queryClient.invalidateQueries({ queryKey: trpc.migration.get.queryKey() });
          toast.info("Translation started...");
        },
        onError: (err) => {
          if (err.message.includes("rate limit")) {
            toast.error("Translation rate limit reached. Please wait a moment and try again.");
          } else {
            toast.error(err.message);
          }
        },
      },
    );
  };

  const handleValidate = () => {
    if (!selectedTeamId) return;
    validateMutation.mutate({ id: projectId, teamId });
  };

  const handleGenerate = () => {
    if (!selectedTeamId || !selectedEnvironmentId || !project) return;
    generateMutation.mutate({
      id: projectId,
      teamId,
      environmentId: selectedEnvironmentId,
      pipelineName: `${project.name} (migrated)`,
    });
  };

  const handleRetranslateBlock = (blockId: string) => {
    if (!selectedTeamId) return;
    retranslateMutation.mutate({
      id: projectId,
      teamId,
      blockId,
    });
  };

  const handleRetryAllFailed = async () => {
    if (!translationResult?.blocks) return;
    const failedBlocks = translationResult.blocks.filter((b) => b.status === "failed");
    for (const block of failedBlocks) {
      await retranslateMutation.mutateAsync({
        id: projectId,
        teamId,
        blockId: block.blockId,
      });
    }
    queryClient.invalidateQueries({
      queryKey: trpc.migration.get.queryKey({ id: projectId, teamId }),
    });
  };

  const handleSaveBlockConfig = (config: Record<string, unknown>) => {
    if (!selectedBlockId) return;
    updateBlockMutation.mutate(
      { id: projectId, teamId, blockId: selectedBlockId, config },
      {
        onSuccess: () => {
          toast.success("Block config saved");
          queryClient.invalidateQueries({
            queryKey: trpc.migration.get.queryKey({ id: projectId, teamId }),
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  if (projectQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return <div className="p-8">Project not found</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/library/migration")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <Badge variant="outline">{project.platform}</Badge>
          <ReadinessBadge score={project.readinessScore} />
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle original config */}
          <Button
            variant={showOriginalConfig ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowOriginalConfig(!showOriginalConfig)}
          >
            <FileText className="h-4 w-4 mr-1" />
            Config
          </Button>

          {/* Translate with AI — always show when parsed */}
          {parsedConfig && !project.generatedPipeline && (
            <Button
              size="sm"
              onClick={handleTranslate}
              disabled={isTranslating || startTranslationMutation.isPending}
            >
              {isTranslating || startTranslationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Translating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" />
                  Translate with AI
                </>
              )}
            </Button>
          )}

          {/* Validate */}
          {translationResult && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleValidate}
              disabled={validateMutation.isPending}
            >
              {validateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Validate
                </>
              )}
            </Button>
          )}

          {/* Generate Pipeline */}
          {translationResult && selectedEnvironmentId && (
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-1" />
                  Generate Pipeline
                </>
              )}
            </Button>
          )}

          {/* View generated pipeline */}
          {project.generatedPipeline && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                router.push(`/pipelines/${project.generatedPipeline!.id}`)
              }
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              View Pipeline
            </Button>
          )}
        </div>
      </div>

      {/* Main layout: topology full-width with collapsible side panels */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left panel: Original config (collapsible overlay) */}
        {showOriginalConfig && (
          <div className="absolute inset-y-0 left-0 z-10 w-80 border-r bg-background shadow-lg overflow-y-auto">
            <div className="flex items-center justify-between p-3 border-b">
              <h3 className="text-sm font-semibold">Original Config</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setShowOriginalConfig(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3">
              <ConfigViewer
                config={project.originalConfig}
                selectedLineRange={selectedBlock?.lineRange ?? null}
              />
            </div>
          </div>
        )}

        {/* Center: Topology (always full width) */}
        <div className="flex-1 flex flex-col">
          {project.validationResult &&
            typeof project.validationResult === "object" &&
            !(project.validationResult as { valid?: boolean }).valid && (() => {
              const errors = (project.validationResult as { errors?: unknown[] }).errors;
              const errorList = Array.isArray(errors)
                ? errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
                : [];
              return (
                <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive space-y-1">
                  <p className="font-medium">
                    Validation failed: {errorList.length} error(s)
                  </p>
                  {errorList.length > 0 && (
                    <ul className="font-mono pl-3 space-y-0.5 max-h-20 overflow-y-auto">
                      {errorList.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
          {parsedConfig ? (
            <MigrationTopology
              parsedConfig={parsedConfig}
              translationResult={translationResult}
              selectedBlockId={selectedBlockId}
              onSelectBlock={setSelectedBlockId}
              isTranslating={isTranslating}
              onRetryAllFailed={handleRetryAllFailed}
            />
          ) : project.status === "FAILED" ? (
            <div className="flex items-center justify-center h-full text-sm text-destructive">
              Parsing failed. Please check your config and try again.
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Parsing config...
            </div>
          )}
        </div>

        {/* Right panel: Block detail (fixed width, only when selected) */}
        {selectedBlock && (
          <div className="w-80 border-l overflow-y-auto shrink-0">
            <BlockDetailPanel
              key={selectedBlock.id + (selectedTranslation?.confidence ?? "")}
              block={selectedBlock}
              translation={selectedTranslation}
              onRetranslate={() => handleRetranslateBlock(selectedBlock.id)}
              onSaveConfig={handleSaveBlockConfig}
              isRetranslating={retranslateMutation.isPending}
              isSaving={updateBlockMutation.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}
