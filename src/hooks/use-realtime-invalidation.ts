"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SSEEvent } from "@/lib/sse/types";
import { useSSE } from "@/hooks/use-sse";

// ── Debounce window for batching invalidations ──────────────────────
const INVALIDATION_DEBOUNCE_MS = 500;

// ── Event type → tRPC query key prefix mapping ─────────────────────

/**
 * Pure function mapping an SSE event type to the tRPC query key prefixes
 * that should be invalidated when that event arrives.
 *
 * Each key prefix is a 2-element array matching tRPC's `[router, procedure]`
 * format, which React Query uses as the query key prefix.
 */
export function getInvalidationKeys(
  eventType: SSEEvent["type"],
): string[][] {
  switch (eventType) {
    case "metric_update":
      return [
        ["dashboard", "stats"],
        ["dashboard", "pipelineCards"],
        ["dashboard", "chartMetrics"],
        ["dashboard", "volumeAnalytics"],
        ["metrics", "getNodePipelineRates"],
        ["fleet", "nodeMetrics"],
        ["fleet", "overview"],
        ["fleet", "volumeTrend"],
      ];

    case "fleet_status":
      return [
        ["dashboard", "stats"],
        ["dashboard", "pipelineCards"],
        ["fleet", "list"],
        ["fleet", "get"],
        ["fleet", "listWithPipelineStatus"],
        ["fleet", "getUptime"],
        ["fleet", "getStatusTimeline"],
      ];

    case "status_change":
      return [
        ["dashboard", "pipelineCards"],
        ["fleet", "list"],
        ["fleet", "get"],
        ["fleet", "listWithPipelineStatus"],
      ];

    case "log_entry":
      return [
        ["pipeline", "logs"],
        ["fleet", "nodeLogs"],
      ];

    default:
      return [];
  }
}

// ── Event types we subscribe to ─────────────────────────────────────
const SUBSCRIBED_EVENTS: SSEEvent["type"][] = [
  "metric_update",
  "fleet_status",
  "status_change",
  "log_entry",
];

// ── React hook ──────────────────────────────────────────────────────

/**
 * Subscribes to SSE events and invalidates the corresponding React Query
 * caches with a 500ms debounce window.
 *
 * Events arriving within the debounce window are batched — their query
 * key prefixes are collected into a Set, and a single invalidation pass
 * runs after 500ms of quiet.
 *
 * Mount this once alongside `useSSE()` in the dashboard layout.
 */
export function useRealtimeInvalidation(): void {
  const queryClient = useQueryClient();
  const { subscribe, unsubscribe } = useSSE();

  // Refs to survive re-renders without re-subscribing
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const subIds: string[] = [];
    const pendingKeys = pendingKeysRef.current;

    for (const eventType of SUBSCRIBED_EVENTS) {
      const id = subscribe(eventType, (event: SSEEvent) => {
        const keys = getInvalidationKeys(event.type);
        for (const key of keys) {
          // Serialize as JSON for Set deduplication
          pendingKeys.add(JSON.stringify(key));
        }

        // Reset debounce timer on each event
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }

        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          const keysToInvalidate = Array.from(pendingKeys);
          pendingKeys.clear();

          for (const serialized of keysToInvalidate) {
            const queryKey = JSON.parse(serialized) as string[];
            queryClient.invalidateQueries({ queryKey });
          }
        }, INVALIDATION_DEBOUNCE_MS);
      });
      subIds.push(id);
    }

    return () => {
      // Unsubscribe from all SSE events
      for (const id of subIds) {
        unsubscribe(id);
      }
      // Clear pending timer
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingKeys.clear();
    };
  }, [subscribe, unsubscribe, queryClient]);
}
