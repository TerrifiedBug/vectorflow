"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

export function PipelineLogs({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const logsQuery = useQuery(
    trpc.pipeline.logs.queryOptions(
      { pipelineId },
      { refetchInterval: 15000 },
    ),
  );

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logsQuery.data]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const allLogs = logsQuery.data ?? [];
  const hasLogs = allLogs.some((n) => n.lines.length > 0);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full overflow-auto bg-black/95 p-3 font-mono text-xs"
    >
      {!hasLogs && (
        <p className="text-muted-foreground">
          No recent logs. Logs are collected from agent heartbeats every 15 seconds.
        </p>
      )}
      {allLogs.map((nodeLog) =>
        nodeLog.lines.map((line, i) => (
          <div key={`${nodeLog.nodeName}-${i}`} className="whitespace-pre-wrap">
            <span className="text-muted-foreground mr-2">[{nodeLog.nodeName}]</span>
            <span className={getLogColor(line)}>{line}</span>
          </div>
        )),
      )}
    </div>
  );
}

function getLogColor(line: string): string {
  if (line.includes("ERROR") || line.includes("error")) return "text-red-400";
  if (line.includes("WARN") || line.includes("warn")) return "text-yellow-400";
  if (line.includes("DEBUG") || line.includes("debug")) return "text-gray-500";
  return "text-gray-300";
}
