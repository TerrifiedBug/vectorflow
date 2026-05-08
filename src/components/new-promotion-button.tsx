"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { PromotePipelineDialog } from "@/components/promote-pipeline-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PromotionPipeline = {
  id: string;
  name: string;
  environmentId: string;
  environmentName: string;
};

type PipelineListResult =
  | Array<{ id: string; name: string }>
  | {
      pipelines: Array<{ id: string; name: string }>;
      nextCursor?: string;
    };

type NewPromotionButtonProps = {
  label: string;
  icon?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
};

type PromotionEnvironment = {
  id: string;
  name: string;
};

type PromotionPipelineFetcher = {
  queryClient: Pick<QueryClient, "fetchQuery">;
  environments: PromotionEnvironment[];
  getQueryOptions: (input: {
    environmentId: string;
    cursor?: string;
    limit: number;
  }) => unknown;
};

function getPipelineItems(data: PipelineListResult | undefined) {
  return Array.isArray(data) ? data : data?.pipelines ?? [];
}

function getNextCursor(data: PipelineListResult | undefined) {
  return Array.isArray(data) ? undefined : data?.nextCursor;
}

export async function fetchPromotionPipelinesForEnvironments({
  queryClient,
  environments,
  getQueryOptions,
}: PromotionPipelineFetcher): Promise<PromotionPipeline[]> {
  const pipelines: PromotionPipeline[] = [];

  for (const environment of environments) {
    let cursor: string | undefined;

    do {
      const data = (await queryClient.fetchQuery(
        getQueryOptions({
          environmentId: environment.id,
          cursor,
          limit: 200,
        }) as never,
      )) as PipelineListResult;

      pipelines.push(
        ...getPipelineItems(data).map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          environmentId: environment.id,
          environmentName: environment.name,
        })),
      );

      cursor = getNextCursor(data);
    } while (cursor);
  }

  return pipelines.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName !== 0 ? byName : left.environmentName.localeCompare(right.environmentName);
  });
}

export function NewPromotionButton({
  label,
  icon,
  variant = "primary",
  size = "sm",
}: NewPromotionButtonProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((state) => state.selectedTeamId);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [promoteTarget, setPromoteTarget] = React.useState<PromotionPipeline | null>(null);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId ?? "" },
      { enabled: Boolean(selectedTeamId) },
    ),
  );

  const environments = (environmentsQuery.data ?? []) as PromotionEnvironment[];
  const pipelinesQuery = useQuery({
    queryKey: [
      "promotion-pipeline-picker",
      selectedTeamId,
      environments.map((environment) => environment.id).join(","),
    ],
    enabled: pickerOpen && Boolean(selectedTeamId) && environments.length > 0,
    queryFn: () =>
      fetchPromotionPipelinesForEnvironments({
        queryClient,
        environments,
        getQueryOptions: (input) =>
          trpc.pipeline.list.queryOptions(input, {
            staleTime: 30_000,
          }),
      }),
  });

  const pipelines = pipelinesQuery.data ?? [];
  const isLoadingPipelines = pickerOpen && pipelinesQuery.isLoading;
  const hasPipelineError = pipelinesQuery.isError;

  const handleSelectPipeline = React.useCallback((pipeline: PromotionPipeline) => {
    setPickerOpen(false);
    setPromoteTarget(pipeline);
  }, []);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={!selectedTeamId}
      >
        {icon}
        {label}
      </Button>
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select pipeline</DialogTitle>
            <DialogDescription>
              Choose the source pipeline to promote into another environment.
            </DialogDescription>
          </DialogHeader>
          <Command className="rounded-[3px] border border-line bg-bg-2">
            <CommandInput placeholder="Search pipelines..." />
            <CommandList>
              {isLoadingPipelines ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-fg-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading pipelines…
                </div>
              ) : hasPipelineError ? (
                <div className="px-3 py-6 text-sm text-status-error">
                  Failed to load pipelines for this team.
                </div>
              ) : (
                <>
                  <CommandEmpty>No pipelines found.</CommandEmpty>
                  <CommandGroup>
                    {pipelines.map((pipeline) => (
                      <CommandItem
                        key={`${pipeline.environmentId}-${pipeline.id}`}
                        value={`${pipeline.name} ${pipeline.environmentName}`}
                        onSelect={() => handleSelectPipeline(pipeline)}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="truncate">{pipeline.name}</span>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
                          {pipeline.environmentName}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      {promoteTarget ? (
        <PromotePipelineDialog
          open={!!promoteTarget}
          onOpenChange={(open) => {
            if (!open) {
              setPromoteTarget(null);
            }
          }}
          pipeline={{
            id: promoteTarget.id,
            name: promoteTarget.name,
            environmentId: promoteTarget.environmentId,
          }}
        />
      ) : null}
    </>
  );
}
