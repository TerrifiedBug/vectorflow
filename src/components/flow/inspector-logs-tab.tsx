"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Node } from "@xyflow/react";
import { useStreamingLogs } from "@/hooks/use-streaming-logs";
import { formatTimeWithSeconds } from "@/lib/format";
import { useTRPC } from "@/trpc/client";

interface InspectorLogsTabProps {
  pipelineId: string;
  node: Node;
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-muted-foreground",
  DEBUG: "text-muted-foreground/70",
  TRACE: "text-muted-foreground/50",
};

function buildEntryMergeKey(entry: { level: string; message: string; timestamp: number | string }) {
  return `${entry.level}\u0000${entry.timestamp}\u0000${entry.message}`;
}

export function InspectorLogsTab({ pipelineId }: InspectorLogsTabProps) {
  const trpc = useTRPC();
  const { streamedEntries } = useStreamingLogs({ pipelineId });
  const logsQuery = useQuery(
    trpc.pipeline.logs.queryOptions({ pipelineId, limit: 50 }),
  );
  const persistedEntries = useMemo(
    () => [...(logsQuery.data?.items ?? [])].reverse(),
    [logsQuery.data?.items],
  );
  const entries = useMemo(() => {
    if (streamedEntries.length === 0) return persistedEntries.slice(-50);

    const persistedKeys = new Set(persistedEntries.map((entry) => buildEntryMergeKey(entry)));
    const uniqueStreamed = streamedEntries.filter((entry) => !persistedKeys.has(buildEntryMergeKey(entry)));

    return [...persistedEntries, ...uniqueStreamed].slice(-50);
  }, [persistedEntries, streamedEntries]);

  if (entries.length === 0) {
    return (
      <div className="m-3.5 space-y-2">
        {logsQuery.isError ? (
          <p className="text-xs text-destructive">
            Unable to load recent pipeline logs.
          </p>
        ) : null}
        {logsQuery.isPending ? (
          <p className="rounded-md border border-dashed border-line-2 px-3 py-4 text-center text-xs text-fg-2">
            Loading recent pipeline log lines…
          </p>
        ) : logsQuery.isSuccess ? (
          <p className="rounded-md border border-dashed border-line-2 px-3 py-6 text-center text-sm text-fg-2">
            No recent pipeline history yet.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="m-3.5 space-y-2">
      {logsQuery.isError ? (
        <p className="text-xs text-destructive">
          Unable to load recent pipeline logs.
        </p>
      ) : null}
      <div className="overflow-hidden rounded-md border">
        <div className="max-h-80 overflow-auto bg-black/95 p-3 font-mono text-xs">
          {entries.map((entry) => (
            <div key={entry.id} className="whitespace-pre-wrap leading-5 text-foreground/85">
              <span className="tabular-nums text-muted-foreground">
                {formatTimeWithSeconds(new Date(entry.timestamp))}
              </span>
              {"  "}
              <span className={`inline-block w-12 ${LEVEL_COLORS[entry.level] ?? "text-muted-foreground"}`}>
                {entry.level}
              </span>
              {"  "}
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
