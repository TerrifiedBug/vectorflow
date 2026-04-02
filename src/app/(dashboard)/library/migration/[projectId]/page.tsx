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

  const teamId = selectedTeamId!;

  const projectQuery = useQuery(
    trpc.migration.get.queryOptions(
      { id: projectId, teamId },
      {
        enabled: !!selectedTeamId,
        refetchInterval: (query) =>
          query.state.data?.status === "TRANSLATING" ? 2000 : false,
      },
    ),
  );

  const project = projectQuery.data;
  const isTranslating = project?.status === "TRANSLATING";
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
          toast.error(`Validation failed: ${result.errors.length} errors`);
        }
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

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Original config */}
        <div className="w-1/4 min-w-[200px] border-r overflow-y-auto p-4">
          <h3 className="text-sm font-semibold mb-2">Original Config</h3>
          <ConfigViewer
            config={project.originalConfig}
            selectedLineRange={selectedBlock?.lineRange ?? null}
          />
        </div>

        {/* Center: Topology */}
        <div className="flex-1 min-w-[300px] flex flex-col">
          {project.validationResult &&
            !(project.validationResult as { valid: boolean }).valid && (
              <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive space-y-1">
                <p className="font-medium">
                  Validation failed:{" "}
                  {(
                    (project.validationResult as { errors: string[] }).errors ?? []
                  ).length}{" "}
                  error(s)
                </p>
                <ul className="font-mono pl-3 space-y-0.5">
                  {((project.validationResult as { errors: string[] }).errors ?? []).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
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

        {/* Right panel: Block detail */}
        <div className="w-1/4 min-w-[200px] border-l overflow-y-auto">
          {selectedBlock ? (
            <BlockDetailPanel
              key={selectedBlock.id + (selectedTranslation?.confidence ?? "")}
              block={selectedBlock}
              translation={selectedTranslation}
              onRetranslate={() => handleRetranslateBlock(selectedBlock.id)}
              onSaveConfig={handleSaveBlockConfig}
              isRetranslating={retranslateMutation.isPending}
              isSaving={updateBlockMutation.isPending}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Select a block in the topology to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
