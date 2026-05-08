"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
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

type StreamedLogEntry = {
  level: string;
  message: string;
  timestamp: number;
  raw: string;
};
type SeededLogEntry = { id: string; level: string; message: string; timestamp: number };
type HistoryState = {
  pipelineId: string;
  historySeeded: boolean;
  seededEntries: SeededLogEntry[];
  seededStreamEntryCount: number;
};
type HistoryAction =
  | { type: "reset"; pipelineId: string }
  | {
      type: "seed";
      pipelineId: string;
      seededEntries: SeededLogEntry[];
      seededStreamEntryCount: number;
    };

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-muted-foreground",
  DEBUG: "text-muted-foreground/70",
  TRACE: "text-muted-foreground/50",
};

function timestampMs(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "reset":
      if (
        state.pipelineId === action.pipelineId
        && !state.historySeeded
        && state.seededEntries.length === 0
      ) {
        return state;
      }

      return {
        pipelineId: action.pipelineId,
        historySeeded: false,
        seededEntries: [],
        seededStreamEntryCount: 0,
      };
    case "seed":
      return {
        pipelineId: action.pipelineId,
        historySeeded: true,
        seededEntries: action.seededEntries,
        seededStreamEntryCount: action.seededStreamEntryCount,
      };
  }
}

export function InspectorLogsTab({ pipelineId }: InspectorLogsTabProps) {
  const trpc = useTRPC();
  const { subscribe, unsubscribe } = useSSE();
  const [streamState, setStreamState] = useState<{
    pipelineId: string;
    entries: StreamedLogEntry[];
  }>({ pipelineId, entries: [] });
  const [historyState, dispatchHistory] = useReducer(historyReducer, {
    pipelineId,
    historySeeded: false,
    seededEntries: [],
    seededStreamEntryCount: 0,
  });
  const { pipelineId: seededPipelineId, historySeeded, seededEntries, seededStreamEntryCount } = historyState;
  const hasSeededHistory = historySeeded && seededPipelineId === pipelineId;
  const logsQuery = useQuery(
    trpc.pipeline.logs.queryOptions(
      { pipelineId, limit: 50 },
      {
        enabled: !hasSeededHistory,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      },
    ),
  );

  useEffect(() => {
    dispatchHistory({ type: "reset", pipelineId });
  }, [pipelineId]);

  useEffect(() => {
    if (!logsQuery.isSuccess || hasSeededHistory) return;

    const seededEntries: SeededLogEntry[] = [...(logsQuery.data.items ?? [])]
      .reverse()
      .map((entry) => ({
        id: entry.id,
        level: entry.level,
        message: entry.message,
        timestamp: timestampMs(entry.timestamp),
      }));
    dispatchHistory({
      type: "seed",
      pipelineId,
      seededEntries,
      seededStreamEntryCount:
        streamState.pipelineId === pipelineId ? streamState.entries.length : 0,
    });
  }, [
    hasSeededHistory,
    logsQuery.data?.items,
    logsQuery.isSuccess,
    pipelineId,
    streamState.entries.length,
    streamState.pipelineId,
  ]);

  useEffect(() => {
    const subId = subscribe("log_entry", (event) => {
      const logEvent = event as LogEntryEvent;
      if (logEvent.pipelineId !== pipelineId || logEvent.lines.length === 0) return;

      const now = Date.now();
      const nextEntries = logEvent.lines.map((line, index) => {
        const parsed = parseLogLine(line, now + index);
        return { ...parsed, raw: line };
      });

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

  const visibleSeededEntries = useMemo(
    () => (seededPipelineId === pipelineId ? seededEntries : []),
    [pipelineId, seededEntries, seededPipelineId],
  );
  const streamedEntries = useMemo(() => {
    if (streamState.pipelineId !== pipelineId) return [];
    if (!hasSeededHistory) return streamState.entries;

    const preSeedEntries = streamState.entries.slice(0, seededStreamEntryCount);
    const postSeedEntries = streamState.entries.slice(seededStreamEntryCount);
    const seededDedupEntries = seededEntries.map((seededEntry) => {
      const parsed = parseLogLine(seededEntry.message, seededEntry.timestamp);
      return {
        level: seededEntry.level,
        raw: seededEntry.message,
        timestamp: parsed.timestamp,
      };
    });
    const dedupedPreSeedEntries = preSeedEntries.filter((entry) =>
      !seededDedupEntries.some(
        (seededEntry) =>
          seededEntry.level === entry.level
          && seededEntry.raw === entry.raw
          && Math.abs(seededEntry.timestamp - entry.timestamp) <= 1500,
      ),
    );

    return [...dedupedPreSeedEntries, ...postSeedEntries];
  }, [
    hasSeededHistory,
    pipelineId,
    seededEntries,
    seededStreamEntryCount,
    streamState,
  ]);
  const entries = useMemo(
    () => [...visibleSeededEntries, ...streamedEntries].slice(-50),
    [streamedEntries, visibleSeededEntries],
  );
  const showQueryError = !hasSeededHistory && logsQuery.isError;
  const showLoading = !hasSeededHistory && streamedEntries.length === 0 && logsQuery.isPending;

  if (entries.length === 0) {
    return (
      <div className="m-3.5 space-y-2">
        {showQueryError ? (
          <p className="text-xs text-destructive">
            Unable to load recent pipeline history.
          </p>
        ) : null}
        {showLoading ? (
          <p className="rounded-md border border-dashed border-line-2 px-3 py-4 text-center text-xs text-fg-2">
            Loading recent pipeline history and log lines…
          </p>
        ) : hasSeededHistory || logsQuery.isSuccess ? (
          <p className="rounded-md border border-dashed border-line-2 px-3 py-6 text-center text-sm text-fg-2">
            No recent pipeline history yet.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="m-3.5 space-y-2">
      {showQueryError ? (
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
