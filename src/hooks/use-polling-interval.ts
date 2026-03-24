"use client";

import { useSSEStore } from "@/stores/sse-store";

// ── Minimum polling floor (R020) ─────────────────────────────────────
const MIN_POLLING_MS = 30_000;

// ── Pure logic (testable without React) ──────────────────────────────

/**
 * Compute the polling interval based on SSE connection status.
 *
 * - `connected` → `false` (polling suppressed, SSE pushes updates)
 * - `disconnected` | `reconnecting` → `Math.max(baseInterval, 30_000)`
 *
 * The 30s floor ensures we don't overwhelm the server when falling back
 * to polling while SSE is unavailable.
 */
export function getPollingInterval(
  status: "connected" | "disconnected" | "reconnecting",
  baseInterval: number,
): number | false {
  if (status === "connected") return false;
  return Math.max(baseInterval, MIN_POLLING_MS);
}

// ── React hook wrapper ───────────────────────────────────────────────

/**
 * Hook that returns the appropriate `refetchInterval` value for React
 * Query based on the current SSE connection status.
 *
 * Usage:
 * ```ts
 * const { data } = useQuery({
 *   ...queryOptions,
 *   refetchInterval: usePollingInterval(15_000),
 * });
 * ```
 */
export function usePollingInterval(baseInterval: number): number | false {
  const status = useSSEStore((s) => s.status);
  return getPollingInterval(status, baseInterval);
}
