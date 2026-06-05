/**
 * Trace tail-based sampling (A6) — shared, pure helpers.
 *
 * Vector has no native tail-sampling processor, so the `tail_sample` transform
 * compiles to a three-stage Vector subgraph (see
 * docs/internal/trace-tail-sampling.md):
 *
 *   1. `remap`  — normalize each span's tail-sampling signals (error flag,
 *                 duration, captured raw span) before buffering.
 *   2. `reduce` — buffer spans by `trace_id` over a flush window
 *                 (`expire_after_ms`), accumulating per-trace signals
 *                 (`vf_error` via `max`, `vf_duration_ms` via `max`, the span
 *                 array via `array`). One trace → one buffered event.
 *   3. `filter` — apply the keep decision (keep if error OR slow OR within the
 *                 probabilistic baseline %) and DROP non-kept traces.
 *
 * Because the decision runs on the single reduced event per trace, a trace is
 * kept or dropped *atomically* (whole-trace integrity).
 *
 * This module is dependency-free and client-safe: the YAML generator
 * (`@/lib/config-generator`) renders the Vector blocks from it, the editor
 * detail panel normalizes config with it, and the server-side simulator
 * (`@/server/services/trace-sampling`) reuses its types + normalization so the
 * preview and the deployed config stay in lockstep.
 */

/** Catalog `type` for the trace tail-sampling transform in the editor graph. */
export const TAIL_SAMPLE_TYPE = "tail_sample";

/** Default trace-identifying field. */
export const DEFAULT_TAIL_SAMPLE_KEY = "trace_id";
/** Default per-trace buffering window (ms) — matches Vector reduce default. */
export const DEFAULT_TAIL_SAMPLE_WINDOW_MS = 30_000;
/** Default probabilistic baseline kept percentage. */
export const DEFAULT_TAIL_SAMPLE_BASELINE_PERCENT = 10;

/**
 * Keep policy: a trace is kept if ANY enabled clause matches. With every clause
 * disabled the transform stays inert (keeps everything) rather than silently
 * dropping all trace data.
 */
export interface TailSampleKeepPolicy {
  /** Always keep traces where any span errored. */
  onError: boolean;
  /** Always keep traces whose slowest span lasts ≥ this many ms. `null` disables. */
  slowThresholdMs: number | null;
  /** Probabilistic baseline: keep ~this percent (0–100) of the remaining traces. */
  baselinePercent: number;
}

export interface TailSampleConfig {
  /** Field identifying a trace; spans sharing it are decided together. */
  key: string;
  /** Per-trace buffering window before the keep/drop decision flushes (ms). */
  windowMs: number;
  keepPolicies: TailSampleKeepPolicy;
}

export const DEFAULT_TAIL_SAMPLE_KEEP_POLICY: TailSampleKeepPolicy = {
  onError: true,
  slowThresholdMs: null,
  baselinePercent: DEFAULT_TAIL_SAMPLE_BASELINE_PERCENT,
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Coerce a possibly-partial editor config (or validated procedure input) into a
 * complete, sane `TailSampleConfig`. Idempotent on already-valid input.
 */
export function normalizeTailSampleConfig(raw: unknown): TailSampleConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const rawPolicies = (cfg.keepPolicies ?? {}) as Record<string, unknown>;

  const key =
    typeof cfg.key === "string" && cfg.key.trim() !== ""
      ? cfg.key.trim()
      : DEFAULT_TAIL_SAMPLE_KEY;

  const windowCandidate = toFiniteNumber(cfg.windowMs);
  const windowMs =
    windowCandidate != null && windowCandidate > 0
      ? Math.floor(windowCandidate)
      : DEFAULT_TAIL_SAMPLE_WINDOW_MS;

  const slow = toFiniteNumber(rawPolicies.slowThresholdMs);
  const baseline = toFiniteNumber(rawPolicies.baselinePercent);

  return {
    key,
    windowMs,
    keepPolicies: {
      // Default-on: only an explicit `false` disables the error keep policy.
      onError: rawPolicies.onError !== false,
      slowThresholdMs: slow != null && slow > 0 ? slow : null,
      baselinePercent:
        baseline != null
          ? Math.min(100, Math.max(0, baseline))
          : DEFAULT_TAIL_SAMPLE_BASELINE_PERCENT,
    },
  };
}

/**
 * Render a field name as a VRL path expression (`trace_id` → `.trace_id`).
 * Simple dotted identifier paths pass through; anything else is quoted as a
 * single path segment so unusual field names stay valid VRL.
 */
export function vrlFieldPath(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(key)) {
    return `.${key}`;
  }
  return `."${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build the VRL keep-decision program for the trace tail-sampling `filter`.
 * Runs against the single reduced event per trace, so the boolean result keeps
 * or drops the whole trace atomically. Returns `"true"` (inert keep-all) when
 * no keep policy is enabled — we never silently drop all trace data.
 *
 * Each clause is written to be statically infallible: error coalescing (`??`)
 * is applied only to genuinely fallible ops (`to_string`/`to_float`/`mod`),
 * never to plain field access, and only `==`/`>=`/`<` over already-coerced
 * values are used for comparisons.
 */
export function buildTailSampleKeepVrl(config: TailSampleConfig): string {
  const kp = config.keepPolicies;
  const lines: string[] = [];
  const terms: string[] = [];

  if (kp.onError) {
    // `vf_error` is the reduce `max` of per-span 0/1 flags → 1 iff any errored.
    lines.push("has_error = .vf_error == 1");
    terms.push("has_error");
  }
  if (kp.slowThresholdMs != null) {
    lines.push(
      `is_slow = (to_float(.vf_duration_ms) ?? 0.0) >= ${kp.slowThresholdMs}`,
    );
    terms.push("is_slow");
  }
  if (kp.baselinePercent > 0) {
    const keyExpr = `to_string(${vrlFieldPath(config.key)}) ?? ""`;
    lines.push(
      `in_baseline = (mod(abs(seahash(${keyExpr})), 100) ?? 0) < ${kp.baselinePercent}`,
    );
    terms.push("in_baseline");
  }

  if (terms.length === 0) {
    return "true";
  }

  lines.push(terms.join(" || "));
  return lines.join("\n");
}

/**
 * Expand a `tail_sample` editor node into its Vector transform blocks:
 * `<key>__tail_prepare` (remap) → `<key>__tail_collect` (reduce) →
 * `<key>__tail_keep` (keep-decision filter) → `<key>__tail_expand` (remap,
 * unnest) → `<key>` (remap, restore span). The final remap reuses the node's
 * `componentKey` so downstream `inputs` resolve to the per-span sampled output.
 */
export function renderTailSampleBlocks(
  componentKey: string,
  rawConfig: unknown,
  inputs: string[],
): Record<string, Record<string, unknown>> {
  const config = normalizeTailSampleConfig(rawConfig);
  const prepareKey = `${componentKey}__tail_prepare`;
  const collectKey = `${componentKey}__tail_collect`;
  const keepKey = `${componentKey}__tail_keep`;
  const expandKey = `${componentKey}__tail_expand`;

  // Capture the raw span first (clean), then derive top-level numeric signals
  // the reduce can aggregate with `max`.
  const prepareSource = [
    "# VectorFlow tail-sampling: normalize per-span signals before buffering.",
    ".vf_span = .",
    "err = false",
    "if .error == true { err = true }",
    'if downcase(to_string(.status) ?? "") == "error" { err = true }',
    "if (to_int(.status_code) ?? 0) >= 2 { err = true }",
    ".vf_error = 0",
    "if err { .vf_error = 1 }",
    ".vf_duration_ms = to_float(.duration_ms) ?? to_float(.duration) ?? 0.0",
  ].join("\n");

  const blocks: Record<string, Record<string, unknown>> = {};

  blocks[prepareKey] = {
    type: "remap",
    ...(inputs.length > 0 ? { inputs } : {}),
    source: prepareSource,
  };

  blocks[collectKey] = {
    type: "reduce",
    inputs: [prepareKey],
    group_by: [config.key],
    expire_after_ms: config.windowMs,
    merge_strategies: {
      vf_error: "max",
      vf_duration_ms: "max",
      vf_span: "array",
    },
  };

  // Keep or drop the whole trace atomically, deciding on the single reduced event.
  blocks[keepKey] = {
    type: "filter",
    inputs: [collectKey],
    condition: {
      type: "vrl",
      source: buildTailSampleKeepVrl(config),
    },
  };

  // Fan the kept trace's buffered spans back out into individual events so trace
  // sinks receive the original spans, not the reduced aggregate wrapper. `unnest`
  // assigned to the root emits one event per array element; the final remap
  // restores each span as the event root (dropping the vf_* sampling scratch).
  blocks[expandKey] = {
    type: "remap",
    inputs: [keepKey],
    source: ". = unnest!(.vf_span)",
  };
  blocks[componentKey] = {
    type: "remap",
    inputs: [expandKey],
    source: ". = object!(.vf_span)",
  };

  return blocks;
}
