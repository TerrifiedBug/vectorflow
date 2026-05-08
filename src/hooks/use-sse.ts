"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SSEEvent } from "@/lib/sse/types";
import { generateId } from "@/lib/utils";
import { useSSEStore } from "@/stores/sse-store";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";

// ── Constants ────────────────────────────────────────────────────────

const SSE_ENDPOINT = "/api/sse";
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

const EVENT_TYPES: SSEEvent["type"][] = [
  "metric_update",
  "fleet_status",
  "log_entry",
  "status_change",
  "tap_event",
  "tap_stopped",
];

// ── Types ────────────────────────────────────────────────────────────

type SSESubscriber = {
  eventType: SSEEvent["type"];
  callback: (event: SSEEvent) => void;
};

// Module-level guard: only one EventSource connection per browser tab.
let activeConnectionCount = 0;

// Module-level subscriber registry shared across all hook instances.
// The owner instance's dispatch reads from this map; any instance's
// subscribe/unsubscribe writes to it.
const subscribers = new Map<string, SSESubscriber>();

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Subscription API for the shared SSE event bus.
 *
 * Call `useSSEConnection()` once at the app root to own the EventSource
 * connection. Consumers elsewhere call `useSSE()` only to subscribe to typed
 * events without opening another connection.
 */
export function useSSE() {
  const status = useSSEStore((s) => s.status);

  const subscribe = useCallback(
    (
      eventType: SSEEvent["type"],
      callback: (event: SSEEvent) => void,
    ): string => {
      const id = generateId();
      subscribers.set(id, { eventType, callback });
      return id;
    },
    [],
  );

  const unsubscribe = useCallback((id: string): void => {
    subscribers.delete(id);
  }, []);

  return { status, subscribe, unsubscribe };
}

export function useSSEConnection() {
  const setStatus = useSSEStore((s) => s.setStatus);
  const setLastConnectedAt = useSSEStore((s) => s.setLastConnectedAt);
  const visible = useDocumentVisibility();
  const eventBufferRef = useRef<SSEEvent[]>([]);
  const visibleRef = useRef(visible);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const isOwnerRef = useRef(false);


  // ── Dispatch to subscribers ──────────────────────────────────────

  const dispatch = useCallback((event: SSEEvent) => {
    for (const sub of subscribers.values()) {
      if (sub.eventType === event.type) {
        try {
          sub.callback(event);
        } catch {
          // subscriber errors must not break the event loop
        }
      }
    }
  }, []);

  // Keep visibility ref in sync
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  // Flush buffered events when tab becomes visible
  useEffect(() => {
    if (visible && eventBufferRef.current.length > 0) {
      const buffered = eventBufferRef.current;
      eventBufferRef.current = [];
      for (const event of buffered) {
        dispatch(event);
      }
    }
  }, [visible, dispatch]);

  // ── Connect / reconnect ──────────────────────────────────────────

  const connect = useCallback(() => {
    // Close any previous source before opening a new one
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const es = new EventSource(SSE_ENDPOINT);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      setLastConnectedAt(Date.now());
      backoffRef.current = INITIAL_BACKOFF_MS; // reset on success
    };

    es.onerror = () => {
      setStatus("reconnecting");
      es.close();
      eventSourceRef.current = null;

      // Schedule reconnect with exponential backoff
      const delay = backoffRef.current;
      backoffRef.current = Math.min(
        delay * BACKOFF_MULTIPLIER,
        MAX_BACKOFF_MS,
      );

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    // Register typed event listeners for each SSE event name
    for (const eventType of EVENT_TYPES) {
      es.addEventListener(eventType, ((e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data) as SSEEvent;
          if (visibleRef.current) {
            dispatch(parsed);
          } else {
            eventBufferRef.current.push(parsed);
          }
        } catch {
          // malformed event — drop silently
        }
      }) as EventListener);
    }
  }, [dispatch, setStatus, setLastConnectedAt]);

  // ── Lifecycle ────────────────────────────────────────────────────

  useEffect(() => {
    // Guard: only one connection per tab
    if (activeConnectionCount > 0) {
      console.debug(
        "[useSSE] Multiple mounts detected — skipping duplicate connection. " +
          "Call useSSE() once at the app root.",
      );
      return;
    }

    activeConnectionCount++;
    isOwnerRef.current = true;
    connect();

    return () => {
      if (!isOwnerRef.current) return;
      activeConnectionCount--;
      isOwnerRef.current = false;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setStatus("disconnected");
    };
  }, [connect, setStatus]);


}

// ── Test-only exports ────────────────────────────────────────────────
// Exposed so contract tests can verify the module-level subscriber
// registry without mocking internals. Not part of the public API.

/** Dispatch an event to all matching subscribers. Mirrors the hook's dispatch logic. */
function dispatchEvent(event: SSEEvent): void {
  for (const sub of subscribers.values()) {
    if (sub.eventType === event.type) {
      try {
        sub.callback(event);
      } catch {
        // subscriber errors must not break the event loop
      }
    }
  }
}

/** @internal */
export const __testing = { subscribers, dispatchEvent } as const;
