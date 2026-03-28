"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { highlightMatch } from "@/components/log-search-utils";
import { formatTimeWithSeconds } from "@/lib/format";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import {
  useStreamingLogs,
  fingerprint,
} from "@/hooks/use-streaming-logs";
import type { LogLevel } from "@/generated/prisma";

const ALL_LEVELS: LogLevel[] = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];

const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-muted-foreground",
  DEBUG: "text-muted-foreground/70",
  TRACE: "text-muted-foreground/50",
};

const LEVEL_BADGE_COLORS: Record<LogLevel, string> = {
  ERROR: "bg-red-500/20 text-red-400 transition-colors hover:bg-red-500/30",
  WARN: "bg-yellow-500/20 text-yellow-400 transition-colors hover:bg-yellow-500/30",
  INFO: "bg-muted/30 text-muted-foreground transition-colors hover:bg-muted/50",
  DEBUG: "bg-muted/20 text-muted-foreground/70 transition-colors hover:bg-muted/40",
  TRACE: "bg-muted/15 text-muted-foreground/50 transition-colors hover:bg-muted/30",
};

interface PipelineOption {
  id: string;
  name: string;
}

interface NodeLogsProps {
  nodeId: string;
  pipelines: PipelineOption[];
}

export function NodeLogs({ nodeId, pipelines }: NodeLogsProps) {
  const trpc = useTRPC();
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(
    new Set(ALL_LEVELS),
  );
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  const pollingInterval = usePollingInterval(5000);
  const { streamedEntries } = useStreamingLogs({
    nodeId,
  });

  const queryInput = {
    nodeId,
    ...(activeLevels.size < ALL_LEVELS.length
      ? { levels: [...activeLevels] as LogLevel[] }
      : {}),
    ...(selectedPipelineId ? { pipelineId: selectedPipelineId } : {}),
  };

  const logsQuery = useInfiniteQuery(
    trpc.fleet.nodeLogs.infiniteQueryOptions(queryInput, {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchInterval: pollingInterval,
    }),
  );

  const allItems = logsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const displayItems = [...allItems].reverse();

  // Merge SSE-streamed entries, deduplicating against query data
  const mergedItems = (() => {
    if (streamedEntries.length === 0) return displayItems;

    const queryFingerprints = new Set(
      displayItems.map((log) => fingerprint(log.level, log.message)),
    );

    const uniqueStreamed = streamedEntries.filter(
      (entry) => !queryFingerprints.has(fingerprint(entry.level, entry.message)),
    );

    return [...displayItems, ...uniqueStreamed];
  })();

  const filteredItems = (() => {
    let items = mergedItems;

    // Filter by active level
    if (activeLevels.size < ALL_LEVELS.length) {
      items = items.filter((log) => activeLevels.has(log.level as LogLevel));
    }

    // Filter by search term
    if (searchTerm) {
      items = items.filter((log) =>
        log.message.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }

    return items;
  })();

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mergedItems.length]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;

    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;

    if (scrollTop === 0 && logsQuery.hasNextPage && !logsQuery.isFetchingNextPage) {
      const prevHeight = scrollRef.current.scrollHeight;
      logsQuery.fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
          }
        });
      });
    }
  }, [logsQuery]);

  function toggleLevel(level: LogLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size > 1) next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  return (
    <div className="flex h-[400px] flex-col rounded-md border overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-black/80 px-3 py-1.5">
        <span className="text-xs text-muted-foreground mr-1">Level:</span>
        {ALL_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => toggleLevel(level)}
            aria-label={`Filter ${level.toLowerCase()} logs`}
            className={`cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
              activeLevels.has(level)
                ? LEVEL_BADGE_COLORS[level]
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {level}
          </button>
        ))}
        {pipelines.length > 1 && (
          <>
            <div className="mx-1 h-4 w-px bg-border/40" />
            <Select
              value={selectedPipelineId || "__all__"}
              onValueChange={(v) =>
                setSelectedPipelineId(v === "__all__" ? "" : v)
              }
            >
              <SelectTrigger className="h-6 w-[160px] text-xs bg-transparent border-border/40">
                <SelectValue placeholder="All pipelines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All pipelines</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <div className="mx-1 h-4 w-px bg-border/40" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search logs..."
            className="h-6 w-[180px] pl-7 text-xs bg-transparent border-border/40"
          />
        </div>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {searchTerm
            ? `${filteredItems.length}/${mergedItems.length} lines`
            : `${mergedItems.length} lines`}
        </span>
        {logsQuery.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-xs px-2"
            onClick={() => logsQuery.fetchNextPage()}
            disabled={logsQuery.isFetchingNextPage}
          >
            {logsQuery.isFetchingNextPage ? "Loading..." : "Load older"}
          </Button>
        )}
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-black/95 p-3 font-mono text-xs"
      >
        {logsQuery.isFetchingNextPage && (
          <div className="text-center text-muted-foreground py-1 text-xs">
            Loading older logs...
          </div>
        )}
        {mergedItems.length === 0 && !logsQuery.isLoading && (
          <p className="text-muted-foreground">
            No logs yet. Logs are collected from agent heartbeats every 5 seconds.
          </p>
        )}
        {filteredItems.map((log) => {
          const ts = log.timestamp instanceof Date
            ? log.timestamp
            : new Date(log.timestamp);
          const pipelineName = "pipeline" in log ? (log.pipeline as { name: string })?.name : undefined;
          return (
            <div key={log.id} className="whitespace-pre-wrap leading-5">
              <span className="text-muted-foreground tabular-nums">{formatTimeWithSeconds(ts)}</span>
              {"  "}
              <span className={`${LEVEL_COLORS[log.level as LogLevel]} inline-block w-12`}>
                {log.level}
              </span>
              {"  "}
              {pipelineName && (
                <span className="text-blue-400/70">[{pipelineName}]</span>
              )}
              {"  "}
              <span className="text-foreground/80">
                {searchTerm ? highlightMatch(log.message, searchTerm) : log.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
