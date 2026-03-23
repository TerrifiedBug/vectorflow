"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { highlightMatch } from "@/components/log-search-utils";
import { formatTimeWithSeconds } from "@/lib/format";
import type { LogLevel } from "@/generated/prisma";

const ALL_LEVELS: LogLevel[] = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];

const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-gray-300",
  DEBUG: "text-gray-500",
  TRACE: "text-gray-600",
};

const LEVEL_BADGE_COLORS: Record<LogLevel, string> = {
  ERROR: "bg-red-500/20 text-red-400 transition-colors hover:bg-red-500/30",
  WARN: "bg-yellow-500/20 text-yellow-400 transition-colors hover:bg-yellow-500/30",
  INFO: "bg-gray-500/20 text-gray-300 transition-colors hover:bg-gray-500/30",
  DEBUG: "bg-gray-600/20 text-gray-500 transition-colors hover:bg-gray-600/30",
  TRACE: "bg-gray-700/20 text-gray-600 transition-colors hover:bg-gray-700/30",
};

interface PipelineLogsProps {
  pipelineId: string;
  nodeId?: string;
}

export function PipelineLogs({ pipelineId, nodeId }: PipelineLogsProps) {
  const trpc = useTRPC();
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(
    new Set(ALL_LEVELS),
  );
  const [searchTerm, setSearchTerm] = useState("");

  const queryInput = {
    pipelineId,
    ...(activeLevels.size < ALL_LEVELS.length
      ? { levels: [...activeLevels] as LogLevel[] }
      : {}),
    ...(nodeId ? { nodeId } : {}),
  };

  const logsQuery = useInfiniteQuery(
    trpc.pipeline.logs.infiniteQueryOptions(queryInput, {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchInterval: 5000,
    }),
  );

  // All items come back newest-first from the API; reverse for chronological display
  const allItems = logsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const displayItems = [...allItems].reverse();
  const filteredItems = searchTerm
    ? displayItems.filter((log) =>
        log.message.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : displayItems;

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayItems.length]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;

    // If near the bottom, keep auto-scrolling
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;

    // If scrolled to top, load older logs
    if (scrollTop === 0 && logsQuery.hasNextPage && !logsQuery.isFetchingNextPage) {
      const prevHeight = scrollRef.current.scrollHeight;
      logsQuery.fetchNextPage().then(() => {
        // Maintain scroll position after prepending old logs
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
        // Don't allow deselecting all levels
        if (next.size > 1) next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
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
                : "bg-transparent text-gray-700 hover:text-gray-500"
            }`}
          >
            {level}
          </button>
        ))}
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
            ? `${filteredItems.length}/${displayItems.length} lines`
            : `${displayItems.length} lines`}
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
        {displayItems.length === 0 && !logsQuery.isLoading && (
          <p className="text-muted-foreground">
            No logs yet. Logs are collected from agent heartbeats every 15 seconds.
          </p>
        )}
        {filteredItems.map((log) => (
          <div key={log.id} className="whitespace-pre-wrap leading-5">
            <span className="text-gray-600 tabular-nums">{formatTimeWithSeconds(log.timestamp)}</span>
            {"  "}
            <span className={`${LEVEL_COLORS[log.level as LogLevel]} inline-block w-12`}>
              {log.level}
            </span>
            {"  "}
            {log.node?.name && (
              <>
                <span className="text-blue-400/70">[{log.node.name}]</span>
                {"  "}
              </>
            )}
            <span className="text-gray-300">
              {searchTerm ? highlightMatch(log.message, searchTerm) : log.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
