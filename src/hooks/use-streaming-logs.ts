"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntryEvent, SSEEvent } from "@/lib/sse/types";
import { parseLogLine, type ParsedLogEntry } from "@/lib/log-utils";
import { useSSE } from "@/hooks/use-sse";

// ── Constants ────────────────────────────────────────────────────────

/** Maximum streamed entries kept in memory. Oldest are dropped. */
export const MAX_BUFFER_SIZE = 200;

/** Fingerprint dedup window in milliseconds (30s). */
const DEDUP_WINDOW_MS = 30_000;

// ── Dedup Logic (exported for testing) ───────────────────────────────

/**
 * Generate a fingerprint for deduplication.
 * Uses level + first 80 chars of message to identify likely duplicates
 * between SSE-delivered entries and React Query refetch data.
 */
export function fingerprint(level: string, message: string): string {
  return level + ":" + message.slice(0, 80);
}

/** Tracked fingerprint entry with expiry timestamp. */
interface FingerprintRecord {
  fp: string;
  expiresAt: number;
}

/**
 * Prune expired fingerprints from the dedup set.
 * Returns a new array containing only non-expired records.
 */
export function pruneFingerprints(
  records: FingerprintRecord[],
  now: number,
): FingerprintRecord[] {
  return records.filter((r) => r.expiresAt > now);
}

/**
 * Check if a fingerprint already exists (not expired) and optionally add it.
 * Returns true if the entry is a duplicate.
 */
export function isDuplicate(
  records: FingerprintRecord[],
  fp: string,
  now: number,
): boolean {
  return records.some((r) => r.fp === fp && r.expiresAt > now);
}

// ── Buffer Logic (exported for testing) ──────────────────────────────

/**
 * Append new entries to a buffer, capping at maxSize by dropping oldest.
 */
export function appendToBuffer<T>(
  buffer: T[],
  newEntries: T[],
  maxSize: number,
): T[] {
  const combined = [...buffer, ...newEntries];
  if (combined.length <= maxSize) return combined;
  return combined.slice(combined.length - maxSize);
}

// ── Filter Logic (exported for testing) ──────────────────────────────

interface StreamFilter {
  pipelineId?: string;
  nodeId?: string;
}

/**
 * Check if a log_entry SSE event matches the provided filter.
 * If a filter field is set, the event must match it.
 */
export function matchesFilter(
  event: LogEntryEvent,
  filter: StreamFilter,
): boolean {
  if (filter.pipelineId && event.pipelineId !== filter.pipelineId) return false;
  if (filter.nodeId && event.nodeId !== filter.nodeId) return false;
  return true;
}

// ── Types ────────────────────────────────────────────────────────────

/** ParsedLogEntry augmented with a unique ID for React keys. */
export interface StreamedLogEntry extends ParsedLogEntry {
  id: string;
}

// ── Hook ─────────────────────────────────────────────────────────────

interface UseStreamingLogsOptions {
  pipelineId?: string;
  nodeId?: string;
}

/**
 * Subscribe to `log_entry` SSE events, parse raw lines, and expose a
 * buffer of recent `ParsedLogEntry` objects.
 *
 * Entries are deduplicated via fingerprinting (level + message prefix)
 * with a 30-second expiry window. Buffer is capped at 200 entries.
 *
 * @returns `streamedEntries` — array of parsed log entries from SSE,
 *          and `fingerprints` — set of active fingerprint strings for
 *          downstream dedup against React Query data.
 */
export function useStreamingLogs(options: UseStreamingLogsOptions) {
  const { subscribe, unsubscribe } = useSSE();
  const [streamedEntries, setStreamedEntries] = useState<StreamedLogEntry[]>(
    [],
  );
  const fingerprintsRef = useRef<FingerprintRecord[]>([]);
  const filterRef = useRef(options);

  // Keep filter ref in sync via effect (not during render)
  useEffect(() => {
    filterRef.current = options;
  });

  const handleEvent = useCallback((event: SSEEvent) => {
    if (event.type !== "log_entry") return;
    const logEvent = event as LogEntryEvent;

    if (!matchesFilter(logEvent, filterRef.current)) return;

    const now = Date.now();

    // Prune expired fingerprints periodically
    fingerprintsRef.current = pruneFingerprints(fingerprintsRef.current, now);

    const newEntries: StreamedLogEntry[] = [];

    for (let i = 0; i < logEvent.lines.length; i++) {
      const parsed = parseLogLine(logEvent.lines[i], now + i);
      const fp = fingerprint(parsed.level, parsed.message);

      if (isDuplicate(fingerprintsRef.current, fp, now)) continue;

      // Add fingerprint with expiry
      fingerprintsRef.current.push({
        fp,
        expiresAt: now + DEDUP_WINDOW_MS,
      });

      // Assign a unique ID for React keys
      const entry: StreamedLogEntry = {
        ...parsed,
        id: `sse-${now}-${i}`,
      };
      newEntries.push(entry);
    }

    if (newEntries.length === 0) return;

    setStreamedEntries((prev) =>
      appendToBuffer(prev, newEntries, MAX_BUFFER_SIZE),
    );
  }, []);

  useEffect(() => {
    const subId = subscribe("log_entry", handleEvent);
    return () => {
      unsubscribe(subId);
    };
  }, [subscribe, unsubscribe, handleEvent]);

  return {
    /** Parsed log entries received via SSE, newest last. */
    streamedEntries,
  };
}
