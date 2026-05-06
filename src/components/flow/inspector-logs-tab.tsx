"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Node } from "@xyflow/react";
import { useSSE } from "@/hooks/use-sse";
import { formatTimeWithSeconds } from "@/lib/format";
import { parseLogLine } from "@/lib/log-utils";
import type { LogEntryEvent } from "@/lib/sse/types";
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


export function InspectorLogsTab({ pipelineId }: InspectorLogsTabProps) {
  const trpc = useTRPC();
  const { subscribe, unsubscribe } = useSSE();
  const [streamState, setStreamState] = useState<{
    pipelineId: string;
    entries: Array<{ level: string; message: string; timestamp: number }>;
  }>({ pipelineId, entries: [] });
  const logsQuery = useQuery(
    trpc.pipeline.logs.queryOptions(
      { pipelineId, limit: 50 },
      { staleTime: Infinity, refetchOnWindowFocus: false },
    ),
  );
  const persistedEntries = useMemo(
    () => [...(logsQuery.data?.items ?? [])].reverse(),
    [logsQuery.data?.items],
  );


  useEffect(() => {
    const subId = subscribe("log_entry", (event) => {
      const logEvent = event as LogEntryEvent;
      if (logEvent.pipelineId !== pipelineId || logEvent.lines.length === 0) return;

      const now = Date.now();
      const nextEntries = logEvent.lines.map((line, index) =>
        parseLogLine(line, now + index),
      );

      setStreamState((current) => ({
        pipelineId,
        entries:
          current.pipelineId === pipelineId
            ? [...current.entries, ...nextEntries].slice(-50)
            : nextEntries.slice(-50),
      }));
    });

    return () => {
      unsubscribe(subId);
    };
  }, [pipelineId, subscribe, unsubscribe]);
  const streamedEntries = useMemo(
    () => (streamState.pipelineId === pipelineId ? streamState.entries : []),
    [pipelineId, streamState],
  );

  const entries = useMemo(
    () => [...persistedEntries, ...streamedEntries].slice(-50),
    [persistedEntries, streamedEntries],
  );

  if (entries.length === 0) {
    return (
      <div className="m-3.5 space-y-2">
        {logsQuery.isError ? (
          <p className="text-xs text-destructive">
            Unable to load recent pipeline history.
          </p>
        ) : null}
        {logsQuery.isPending ? (
          <p className="rounded-md border border-dashed border-line-2 px-3 py-4 text-center text-xs text-fg-2">
            Loading recent pipeline history and log lines…
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
          Unable to load recent pipeline history.
        </p>
      ) : null}
      <div className="overflow-hidden rounded-md border">
        <div className="max-h-80 overflow-auto bg-black/95 p-3 font-mono text-xs">
          {entries.map((entry, index) => (
            <div
              key={"id" in entry ? entry.id : `streamed-${entry.timestamp}-${index}`}
              className="whitespace-pre-wrap leading-5 text-foreground/85"
            >
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
