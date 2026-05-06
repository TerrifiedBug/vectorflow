"use client";

import { useMemo } from "react";
import type { Node } from "@xyflow/react";
import { useStreamingLogs } from "@/hooks/use-streaming-logs";
import { formatTimeWithSeconds } from "@/lib/format";

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

export function InspectorLogsTab({ pipelineId, node }: InspectorLogsTabProps) {
  const { streamedEntries } = useStreamingLogs({ pipelineId, nodeId: node.id });
  const entries = useMemo(() => streamedEntries.slice(-50), [streamedEntries]);

  if (entries.length === 0) {
    return (
      <p className="m-3.5 rounded-md border border-dashed border-line-2 px-3 py-6 text-center text-sm text-fg-2">
        No recent log lines for this component.
      </p>
    );
  }

  return (
    <div className="m-3.5 overflow-hidden rounded-md border">
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
  );
}
