// Trace tail-sampling preview / simulator (A6).
//
// The deployed mechanism (see docs/internal/trace-tail-sampling.md and
// src/lib/vector/tail-sample.ts) compiles the `tail_sample` transform to a
// Vector `reduce` (buffer spans by trace_id over a flush window, accumulating
// per-trace signals) followed by a keep-decision `filter`. This module mirrors
// that keep decision in pure TypeScript so the editor can preview the
// kept/dropped ratio + projected reduction on REAL sampled traces BEFORE
// deploying. Tail-sampling is opt-in and never default-on — we never want a
// user to discover they dropped wanted traces only after rollout.
//
// Pure logic (no I/O) keeps the simulator hermetic and exactly reproducible.
// The deterministic baseline hash plays the same statistical role as the
// deployed VRL's `mod(abs(seahash(trace_id)), 100)`: it agrees exactly with the
// deployed config on the deterministic error/slow policies and matches the
// baseline *ratio* (not the exact trace selection — a different, JS-side hash).
// Whole-trace integrity is structural: the decision is taken once per trace
// key, so a trace is kept or dropped atomically (every span or none).

import {
  normalizeTailSampleConfig,
  type TailSampleKeepPolicy,
} from "@/lib/vector/tail-sample";

export type KeepReason = "error" | "slow" | "baseline" | "none" | "disabled";

export interface TraceSignals {
  spanCount: number;
  /** True iff any span in the trace errored. */
  hasError: boolean;
  /** The slowest span's duration (ms); 0 when no span carries a duration. */
  maxDurationMs: number;
}

export interface TailSampleSimulation {
  totalTraces: number;
  keptTraces: number;
  droppedTraces: number;
  totalSpans: number;
  keptSpans: number;
  droppedSpans: number;
  /** keptTraces / totalTraces (0–1, 4dp). 0 when no traces. */
  keepRatio: number;
  /** droppedSpans / totalSpans * 100 (2dp) — the trace-volume reduction. */
  spanReductionPercent: number;
  /** droppedBytes / totalBytes * 100 (2dp) — a $-proxy for the reduction. */
  byteReductionPercent: number;
  /** Disjoint keep attribution by precedence (error > slow > baseline). */
  keptByPolicy: { error: number; slow: number; baseline: number };
  /** Trace keys kept / dropped — exposed so callers can verify integrity. */
  keptTraceKeys: string[];
  droppedTraceKeys: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Read a span's trace key. Tries the flat field first (the common `trace_id`
 * case) and falls back to a dotted nested path, mirroring the deployed reduce's
 * `group_by` path semantics. Returns `null` for spans without a trace key —
 * those can't be tail-sampled and are excluded from the simulation.
 */
function readTraceKey(span: Record<string, unknown>, key: string): string | null {
  const direct = span[key];
  if (direct != null) return String(direct);
  if (key.includes(".")) {
    let cur: unknown = span;
    for (const segment of key.split(".")) {
      const rec = asRecord(cur);
      if (!rec) return null;
      cur = rec[segment];
    }
    if (cur != null) return String(cur);
  }
  return null;
}

/**
 * Whether a span errored. Mirrors the deployed prepare-remap VRL:
 * `.error == true` OR `.status == "error"` OR `.status_code >= 2` (OTLP ERROR).
 */
function spanErrored(span: Record<string, unknown>): boolean {
  if (span.error === true) return true;
  const status = span.status;
  if (typeof status === "string" && status.toLowerCase() === "error") return true;
  const code = toNumber(span.status_code);
  return code != null && code >= 2;
}

/** A span's duration in ms. Mirrors the VRL `to_float(.duration_ms) ?? to_float(.duration) ?? 0`. */
function spanDurationMs(span: Record<string, unknown>): number {
  return toNumber(span.duration_ms) ?? toNumber(span.duration) ?? 0;
}

/** Group spans into traces by their (possibly dotted) trace key. */
export function groupTraces(
  events: unknown[],
  key: string,
): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const event of events) {
    const span = asRecord(event);
    if (!span) continue;
    const traceKey = readTraceKey(span, key);
    if (traceKey == null) continue;
    const existing = groups.get(traceKey);
    if (existing) existing.push(span);
    else groups.set(traceKey, [span]);
  }
  return groups;
}

/** Reduce a trace's spans to the per-trace signals the keep decision needs. */
export function computeTraceSignals(spans: Record<string, unknown>[]): TraceSignals {
  let hasError = false;
  let maxDurationMs = 0;
  for (const span of spans) {
    if (spanErrored(span)) hasError = true;
    const duration = spanDurationMs(span);
    if (duration > maxDurationMs) maxDurationMs = duration;
  }
  return { spanCount: spans.length, hasError, maxDurationMs };
}

/**
 * Deterministic 0–99 bucket (FNV-1a/32) for a trace key. Plays the same
 * statistical role as the deployed VRL's `mod(abs(seahash(key)), 100)` — a
 * stable, uniform partition so the same trace always lands the same way —
 * using a JS-side hash, so the *ratio* matches but the exact trace selection
 * differs from the deployed config (documented in the design note).
 */
export function baselineBucket(traceKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < traceKey.length; i++) {
    hash ^= traceKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

/**
 * The keep decision for a single trace. Keep if ANY enabled policy matches;
 * precedence (error > slow > baseline) only drives the attribution `reason`.
 * With no policy enabled the transform stays inert (keeps everything) rather
 * than silently dropping all trace data — matching `buildTailSampleKeepVrl`.
 */
export function decideKeepTrace(
  traceKey: string,
  signals: TraceSignals,
  policy: TailSampleKeepPolicy,
): { keep: boolean; reason: KeepReason } {
  const anyPolicy =
    policy.onError || policy.slowThresholdMs != null || policy.baselinePercent > 0;
  if (!anyPolicy) return { keep: true, reason: "disabled" };

  if (policy.onError && signals.hasError) return { keep: true, reason: "error" };
  if (
    policy.slowThresholdMs != null &&
    signals.maxDurationMs >= policy.slowThresholdMs
  ) {
    return { keep: true, reason: "slow" };
  }
  if (
    policy.baselinePercent > 0 &&
    baselineBucket(traceKey) < policy.baselinePercent
  ) {
    return { keep: true, reason: "baseline" };
  }
  return { keep: false, reason: "none" };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return 0;
  }
}

/**
 * Simulate the tail sampler over a set of sample trace events (from a pasted
 * paste, a saved tap capture, or a lake query) and report kept/dropped traces
 * + spans, the keep ratio, and the projected reduction — the preview surfaced
 * in the editor before a user deploys the (opt-in) sampler.
 */
export function simulateTailSample(
  events: unknown[],
  rawConfig: unknown,
): TailSampleSimulation {
  const config = normalizeTailSampleConfig(rawConfig);
  const groups = groupTraces(events, config.key);

  let keptTraces = 0;
  let keptSpans = 0;
  let keptBytes = 0;
  let totalSpans = 0;
  let totalBytes = 0;
  const keptByPolicy = { error: 0, slow: 0, baseline: 0 };
  const keptTraceKeys: string[] = [];
  const droppedTraceKeys: string[] = [];

  for (const [traceKey, spans] of groups) {
    const signals = computeTraceSignals(spans);
    let traceBytes = 0;
    for (const span of spans) traceBytes += jsonBytes(span);
    totalSpans += spans.length;
    totalBytes += traceBytes;

    const { keep, reason } = decideKeepTrace(traceKey, signals, config.keepPolicies);
    if (keep) {
      keptTraces++;
      keptSpans += spans.length;
      keptBytes += traceBytes;
      keptTraceKeys.push(traceKey);
      if (reason === "error") keptByPolicy.error++;
      else if (reason === "slow") keptByPolicy.slow++;
      else if (reason === "baseline") keptByPolicy.baseline++;
    } else {
      droppedTraceKeys.push(traceKey);
    }
  }

  const totalTraces = groups.size;
  const droppedSpans = totalSpans - keptSpans;
  const droppedBytes = totalBytes - keptBytes;

  return {
    totalTraces,
    keptTraces,
    droppedTraces: totalTraces - keptTraces,
    totalSpans,
    keptSpans,
    droppedSpans,
    keepRatio: totalTraces > 0 ? round(keptTraces / totalTraces, 4) : 0,
    spanReductionPercent:
      totalSpans > 0 ? round((droppedSpans / totalSpans) * 100, 2) : 0,
    byteReductionPercent:
      totalBytes > 0 ? round((droppedBytes / totalBytes) * 100, 2) : 0,
    keptByPolicy,
    keptTraceKeys,
    droppedTraceKeys,
  };
}
