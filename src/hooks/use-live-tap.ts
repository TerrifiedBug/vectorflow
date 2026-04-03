"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useSSE } from "@/hooks/use-sse";
import type { SSEEvent, TapEventSSE, TapStoppedSSE } from "@/lib/sse/types";

// ── Types ───────────────────────────────────────────────────────────

export interface TapEventEntry {
  id: string;
  data: unknown;
}

// ── Constants ───────────────────────────────────────────────────────

const MAX_TAP_EVENTS = 100;

// ── Pure helpers (exported for testing) ─────────────────────────────

/** Prepend new events to buffer, cap at maxSize. Newest first. */
export function appendTapEvents(
  existing: TapEventEntry[],
  incoming: TapEventEntry[],
  maxSize: number,
): TapEventEntry[] {
  if (incoming.length === 0) return existing;
  const reversed = [...incoming].reverse(); // newest first
  const combined = [...reversed, ...existing];
  return combined.slice(0, maxSize);
}

// ── Hook ────────────────────────────────────────────────────────────

interface UseLiveTapOptions {
  pipelineId: string;
  componentId: string;
}

export function useLiveTap({ pipelineId, componentId }: UseLiveTapOptions) {
  const trpc = useTRPC();
  const { subscribe, unsubscribe } = useSSE();

  const [events, setEvents] = useState<TapEventEntry[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const subIdsRef = useRef<string[]>([]);
  const eventCounterRef = useRef(0);

  // ── Mutations ───────────────────────────────────────────────────

  const startMutation = useMutation(
    trpc.pipeline.startTap.mutationOptions({
      onSuccess: (data) => {
        requestIdRef.current = data.requestId;
        setIsActive(true);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  const stopMutation = useMutation(
    trpc.pipeline.stopTap.mutationOptions({
      onSettled: () => {
        requestIdRef.current = null;
        setIsActive(false);
      },
    }),
  );

  // ── SSE subscription ──────────────────────────────────────────

  useEffect(() => {
    if (!isActive || !requestIdRef.current) return;

    const currentRequestId = requestIdRef.current;

    const tapEventSubId = subscribe("tap_event", (event: SSEEvent) => {
      const tapEvent = event as TapEventSSE;
      if (tapEvent.requestId !== currentRequestId) return;

      const entries: TapEventEntry[] = tapEvent.events.map((data) => ({
        id: `tap-${eventCounterRef.current++}`,
        data,
      }));

      setEvents((prev) => appendTapEvents(prev, entries, MAX_TAP_EVENTS));
    });

    const tapStoppedSubId = subscribe("tap_stopped", (event: SSEEvent) => {
      const stoppedEvent = event as TapStoppedSSE;
      if (stoppedEvent.requestId !== currentRequestId) return;

      requestIdRef.current = null;
      setIsActive(false);
    });

    subIdsRef.current = [tapEventSubId, tapStoppedSubId];

    return () => {
      unsubscribe(tapEventSubId);
      unsubscribe(tapStoppedSubId);
      subIdsRef.current = [];
    };
  }, [isActive, subscribe, unsubscribe]);

  // ── Public callbacks ──────────────────────────────────────────

  const start = useCallback(() => {
    setEvents([]);
    setError(null);
    eventCounterRef.current = 0;
    startMutation.mutate({ pipelineId, componentId });
  }, [pipelineId, componentId, startMutation]);

  const stop = useCallback(() => {
    if (requestIdRef.current) {
      // Unsubscribe SSE immediately
      for (const subId of subIdsRef.current) {
        unsubscribe(subId);
      }
      subIdsRef.current = [];

      stopMutation.mutate({ requestId: requestIdRef.current });
    }
  }, [stopMutation, unsubscribe]);

  // ── Cleanup on unmount ────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (requestIdRef.current) {
        stopMutation.mutate({ requestId: requestIdRef.current });
      }
    };
    // Fire-and-forget on unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    events,
    isActive,
    start,
    stop,
    error,
    isStarting: startMutation.isPending,
  };
}
