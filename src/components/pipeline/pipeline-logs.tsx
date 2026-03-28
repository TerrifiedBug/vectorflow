"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, Clock, Download, Copy } from "lucide-react";
import { toast } from "sonner";
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
import { useVirtualizer } from "@tanstack/react-virtual";
import { highlightAllMatches, countMatches } from "@/components/log-search-utils";
import { formatTimeWithSeconds } from "@/lib/format";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import {
  useStreamingLogs,
  fingerprint,
} from "@/hooks/use-streaming-logs";
import type { LogLevel } from "@/generated/prisma";

const ALL_LEVELS: LogLevel[] = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];

const TIME_RANGES = [
  { label: "15m", value: "15", ms: 15 * 60 * 1000 },
  { label: "1h", value: "60", ms: 60 * 60 * 1000 },
  { label: "6h", value: "360", ms: 6 * 60 * 60 * 1000 },
  { label: "1d", value: "1440", ms: 24 * 60 * 60 * 1000 },
  { label: "7d", value: "10080", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "All", value: "all", ms: 0 },
] as const;

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
  const [timeRange, setTimeRange] = useState<string>("60");

  const pollingInterval = usePollingInterval(5000);
  const { streamedEntries } = useStreamingLogs({
    pipelineId,
  });

  const sinceDate = timeRange !== "all"
    ? new Date(Date.now() - (TIME_RANGES.find((t) => t.value === timeRange)?.ms ?? 60 * 60 * 1000))
    : undefined;

  const queryInput = {
    pipelineId,
    ...(activeLevels.size < ALL_LEVELS.length
      ? { levels: [...activeLevels] as LogLevel[] }
      : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(searchTerm.length >= 3 ? { search: searchTerm } : {}),
    ...(sinceDate ? { since: sinceDate } : {}),
  };

  const logsQuery = useInfiniteQuery(
    trpc.pipeline.logs.infiniteQueryOptions(queryInput, {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchInterval: pollingInterval,
    }),
  );

  // All items come back newest-first from the API; reverse for chronological display
  const allItems = logsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const displayItems = [...allItems].reverse();

  // Merge SSE-streamed entries, deduplicating against query data
  const mergedItems = (() => {
    if (streamedEntries.length === 0) return displayItems;

    // Build fingerprint set from query data to avoid showing duplicates
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

  const matchCount = searchTerm
    ? filteredItems.reduce((sum, log) => sum + countMatches(log.message, searchTerm), 0)
    : 0;

  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScrollRef.current) {
      virtualizer.scrollToIndex(filteredItems.length - 1, { align: "end" });
    }
  }, [filteredItems.length, virtualizer]);

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

  const handleExportLogs = useCallback(() => {
    const lines = filteredItems.map((log) => {
      const ts = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
      const nodeName = "node" in log ? (log.node as { name: string } | undefined)?.name : undefined;
      const prefix = nodeName ? `[${nodeName}] ` : "";
      return `${ts.toISOString()} ${log.level} ${prefix}${log.message}`;
    });
    const content = lines.join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredItems]);

  const handleCopyLine = useCallback((log: typeof filteredItems[number]) => {
    const ts = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
    const nodeName = "node" in log ? (log.node as { name: string } | undefined)?.name : undefined;
    const prefix = nodeName ? `[${nodeName}] ` : "";
    const text = `${ts.toISOString()} ${log.level} ${prefix}${log.message}`;
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Failed to copy"),
    );
  }, []);

  const handleCopyAll = useCallback(() => {
    const lines = filteredItems.map((log) => {
      const ts = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
      const nodeName = "node" in log ? (log.node as { name: string } | undefined)?.name : undefined;
      const prefix = nodeName ? `[${nodeName}] ` : "";
      return `${ts.toISOString()} ${log.level} ${prefix}${log.message}`;
    });
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => toast.success(`Copied ${lines.length} lines`),
      () => toast.error("Failed to copy"),
    );
  }, [filteredItems]);

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
                : "bg-transparent text-muted-foreground hover:text-foreground"
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
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="h-6 w-[70px] text-xs bg-transparent border-border/40">
            <Clock className="h-3 w-3 mr-1 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((range) => (
              <SelectItem key={range.value} value={range.value} className="text-xs">
                {range.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleExportLogs}
          disabled={filteredItems.length === 0}
          aria-label="Download logs"
        >
          <Download className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleCopyAll}
          disabled={filteredItems.length === 0}
          aria-label="Copy all visible logs"
        >
          <Copy className="h-3 w-3" />
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {searchTerm
            ? `${filteredItems.length}/${mergedItems.length} lines · ${matchCount} matches`
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
        {filteredItems.length > 0 && (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const log = filteredItems[virtualRow.index];
              const ts = log.timestamp instanceof Date
                ? log.timestamp
                : new Date(log.timestamp);
              const nodeName = "node" in log ? (log.node as { name: string } | undefined)?.name : undefined;
              return (
                <div
                  key={log.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="group absolute left-0 top-0 w-full whitespace-pre-wrap leading-5"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <button
                    className="invisible group-hover:visible absolute right-2 top-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => handleCopyLine(log)}
                    aria-label="Copy log line"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <span className="text-muted-foreground tabular-nums">{formatTimeWithSeconds(ts)}</span>
                  {"  "}
                  <span className={`${LEVEL_COLORS[log.level as LogLevel]} inline-block w-12`}>
                    {log.level}
                  </span>
                  {"  "}
                  {nodeName && (
                    <>
                      <span className="text-blue-400/70">[{nodeName}]</span>
                      {"  "}
                    </>
                  )}
                  <span className="text-foreground/80">
                    {searchTerm ? highlightAllMatches(log.message, searchTerm) : log.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
