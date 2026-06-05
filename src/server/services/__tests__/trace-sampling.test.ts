import { describe, it, expect } from "vitest";
import {
  simulateTailSample,
  decideKeepTrace,
  computeTraceSignals,
  groupTraces,
  baselineBucket,
  type TraceSignals,
} from "../trace-sampling";
import {
  buildTailSampleKeepVrl,
  renderTailSampleBlocks,
  normalizeTailSampleConfig,
  type TailSampleKeepPolicy,
} from "@/lib/vector/tail-sample";

/* ------------------------------------------------------------------ */
/*  Synthetic trace fixtures                                          */
/* ------------------------------------------------------------------ */

function span(
  traceId: string,
  idx: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { trace_id: traceId, span_id: `${traceId}-s${idx}`, duration_ms: 5, ...overrides };
}

const FULL_POLICY: TailSampleKeepPolicy = {
  onError: true,
  slowThresholdMs: 1000,
  baselinePercent: 10,
};

/** Mixed corpus: 3 error traces (3 spans each), 2 slow traces (2 spans each),
 *  200 fast/clean baseline traces (1 span each). Spans are interleaved to make
 *  sure grouping is order-independent. */
function buildCorpus() {
  const errorKeys = ["err-0", "err-1", "err-2"];
  const slowKeys = ["slow-0", "slow-1"];
  const baselineKeys = Array.from({ length: 200 }, (_, i) => `baseline-${i}`);

  const spans: Record<string, unknown>[] = [];
  for (const k of errorKeys) {
    spans.push(span(k, 0), span(k, 1, { status: "error" }), span(k, 2));
  }
  for (const k of slowKeys) {
    spans.push(span(k, 0), span(k, 1, { duration_ms: 1500 }));
  }
  for (const k of baselineKeys) {
    spans.push(span(k, 0));
  }
  // Deterministic interleave so the test never silently depends on input order.
  spans.sort((a, b) => String(a.span_id).localeCompare(String(b.span_id)));

  return { errorKeys, slowKeys, baselineKeys, spans };
}

/* ------------------------------------------------------------------ */
/*  Keep-decision logic                                               */
/* ------------------------------------------------------------------ */

describe("decideKeepTrace — keep policy", () => {
  const clean: TraceSignals = { spanCount: 1, hasError: false, maxDurationMs: 5 };

  it("keeps error traces regardless of baseline bucket", () => {
    // err-0 hashes to bucket >= 10, so baseline alone would NOT keep it.
    expect(baselineBucket("err-0")).toBeGreaterThanOrEqual(10);
    const signals: TraceSignals = { spanCount: 3, hasError: true, maxDurationMs: 5 };
    expect(decideKeepTrace("err-0", signals, FULL_POLICY)).toEqual({
      keep: true,
      reason: "error",
    });
  });

  it("keeps slow traces (slowest span >= threshold)", () => {
    expect(baselineBucket("slow-0")).toBeGreaterThanOrEqual(10);
    const signals: TraceSignals = { spanCount: 2, hasError: false, maxDurationMs: 1500 };
    expect(decideKeepTrace("slow-0", signals, FULL_POLICY)).toEqual({
      keep: true,
      reason: "slow",
    });
  });

  it("keeps a clean trace only when it falls in the baseline bucket", () => {
    // baseline-0 → bucket 7 (< 10) kept; baseline-1 → bucket 88 (>= 10) dropped.
    expect(baselineBucket("baseline-0")).toBeLessThan(10);
    expect(baselineBucket("baseline-1")).toBeGreaterThanOrEqual(10);
    expect(decideKeepTrace("baseline-0", clean, FULL_POLICY)).toEqual({
      keep: true,
      reason: "baseline",
    });
    expect(decideKeepTrace("baseline-1", clean, FULL_POLICY)).toEqual({
      keep: false,
      reason: "none",
    });
  });

  it("does not auto-keep error traces when onError is disabled", () => {
    const signals: TraceSignals = { spanCount: 3, hasError: true, maxDurationMs: 5 };
    const policy: TailSampleKeepPolicy = {
      onError: false,
      slowThresholdMs: null,
      baselinePercent: 0,
    };
    // With every policy off the transform is inert (keep all) — so add a slow
    // policy the error trace does not satisfy to prove onError=false drops it.
    const withSlowOnly: TailSampleKeepPolicy = {
      onError: false,
      slowThresholdMs: 1000,
      baselinePercent: 0,
    };
    expect(decideKeepTrace("err-0", signals, withSlowOnly).keep).toBe(false);
    // sanity: fully-disabled policy is the inert keep-all case, not a drop-all.
    expect(decideKeepTrace("err-0", signals, policy)).toEqual({
      keep: true,
      reason: "disabled",
    });
  });

  it("baselinePercent=0 drops clean traces (when another policy is enabled)", () => {
    const policy: TailSampleKeepPolicy = {
      onError: true,
      slowThresholdMs: null,
      baselinePercent: 0,
    };
    expect(decideKeepTrace("baseline-0", clean, policy)).toEqual({
      keep: false,
      reason: "none",
    });
  });

  it("baselinePercent=100 keeps every trace via baseline", () => {
    const policy: TailSampleKeepPolicy = {
      onError: false,
      slowThresholdMs: null,
      baselinePercent: 100,
    };
    expect(decideKeepTrace("baseline-1", clean, policy)).toEqual({
      keep: true,
      reason: "baseline",
    });
  });

  it("stays inert (keep all) when no keep policy is enabled", () => {
    const policy: TailSampleKeepPolicy = {
      onError: false,
      slowThresholdMs: null,
      baselinePercent: 0,
    };
    expect(decideKeepTrace("anything", clean, policy)).toEqual({
      keep: true,
      reason: "disabled",
    });
  });
});

describe("computeTraceSignals", () => {
  it("flags error if ANY span errored and takes the max duration", () => {
    const signals = computeTraceSignals([
      span("t", 0, { duration_ms: 5 }),
      span("t", 1, { duration_ms: 120, status: "error" }),
      span("t", 2, { duration_ms: 30 }),
    ]);
    expect(signals).toEqual({ spanCount: 3, hasError: true, maxDurationMs: 120 });
  });

  it("recognises the error variants .error / .status / .status_code", () => {
    expect(computeTraceSignals([span("a", 0, { error: true })]).hasError).toBe(true);
    expect(computeTraceSignals([span("b", 0, { status: "ERROR" })]).hasError).toBe(true);
    expect(computeTraceSignals([span("c", 0, { status_code: 2 })]).hasError).toBe(true);
    expect(computeTraceSignals([span("d", 0, { status_code: "2" })]).hasError).toBe(true);
    expect(computeTraceSignals([span("e", 0, { status_code: 1 })]).hasError).toBe(false);
    expect(computeTraceSignals([span("f", 0, { status: "ok" })]).hasError).toBe(false);
  });

  it("falls back to .duration when .duration_ms is absent; else 0", () => {
    expect(computeTraceSignals([{ trace_id: "x", duration: 42 }]).maxDurationMs).toBe(42);
    expect(computeTraceSignals([{ trace_id: "x" }]).maxDurationMs).toBe(0);
  });
});

describe("groupTraces", () => {
  it("groups spans by trace key and skips spans without one", () => {
    const groups = groupTraces(
      [span("a", 0), span("a", 1), span("b", 0), { no_trace: true }, "garbage", null],
      "trace_id",
    );
    expect(groups.size).toBe(2);
    expect(groups.get("a")?.length).toBe(2);
    expect(groups.get("b")?.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Simulator                                                         */
/* ------------------------------------------------------------------ */

describe("simulateTailSample — mixed corpus", () => {
  const { errorKeys, slowKeys, baselineKeys, spans } = buildCorpus();
  const config = {
    key: "trace_id",
    windowMs: 30_000,
    keepPolicies: FULL_POLICY,
  };
  const sim = simulateTailSample(spans, config);
  const groups = groupTraces(spans, "trace_id");

  it("counts every distinct trace", () => {
    expect(sim.totalTraces).toBe(205);
    expect(sim.totalTraces).toBe(groups.size);
    expect(sim.totalSpans).toBe(spans.length); // 3*3 + 2*2 + 200 = 213
  });

  it("keeps ALL error and ALL slow traces", () => {
    const kept = new Set(sim.keptTraceKeys);
    for (const k of errorKeys) expect(kept.has(k)).toBe(true);
    for (const k of slowKeys) expect(kept.has(k)).toBe(true);
    expect(sim.keptByPolicy.error).toBe(errorKeys.length);
    expect(sim.keptByPolicy.slow).toBe(slowKeys.length);
  });

  it("samples the baseline down to ~target percent (deterministic)", () => {
    const expectedBaseline = baselineKeys.filter((k) => baselineBucket(k) < 10).length;
    expect(sim.keptByPolicy.baseline).toBe(expectedBaseline);
    // not all, not none — actually sampling
    expect(expectedBaseline).toBeGreaterThan(0);
    expect(expectedBaseline).toBeLessThan(baselineKeys.length);
    // ratio lands near the 10% target (generous band absorbs hash variance)
    expect(sim.keptByPolicy.baseline / baselineKeys.length).toBeLessThan(0.2);
  });

  it("reports consistent kept/dropped totals", () => {
    const keptByPolicyTotal =
      sim.keptByPolicy.error + sim.keptByPolicy.slow + sim.keptByPolicy.baseline;
    expect(sim.keptTraces).toBe(keptByPolicyTotal);
    expect(sim.keptTraces + sim.droppedTraces).toBe(sim.totalTraces);
    expect(sim.keptSpans + sim.droppedSpans).toBe(sim.totalSpans);
  });

  it("holds whole-trace integrity — no orphan spans", () => {
    const kept = new Set(sim.keptTraceKeys);
    const dropped = new Set(sim.droppedTraceKeys);
    // kept/dropped partition the trace keys with no overlap
    expect(kept.size + dropped.size).toBe(sim.totalTraces);
    for (const k of kept) expect(dropped.has(k)).toBe(false);
    // a kept trace contributes ALL its spans; a dropped trace contributes none
    let keptSpans = 0;
    for (const k of sim.keptTraceKeys) keptSpans += (groups.get(k) ?? []).length;
    expect(sim.keptSpans).toBe(keptSpans);
    expect(sim.droppedSpans).toBe(sim.totalSpans - keptSpans);
    // spot-check: the 3 spans of an error trace all survive together
    expect(kept.has("err-0")).toBe(true);
    expect((groups.get("err-0") ?? []).length).toBe(3);
  });

  it("computes simulator math (ratio + reduction)", () => {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const round4 = (n: number) => Math.round(n * 10000) / 10000;
    expect(sim.keepRatio).toBe(round4(sim.keptTraces / sim.totalTraces));
    expect(sim.spanReductionPercent).toBe(
      round2((sim.droppedSpans / sim.totalSpans) * 100),
    );
    expect(sim.byteReductionPercent).toBeGreaterThan(0);
    expect(sim.byteReductionPercent).toBeLessThanOrEqual(100);
    // most spans are dropped (only ~27 of 205 traces kept)
    expect(sim.spanReductionPercent).toBeGreaterThan(50);
  });
});

describe("simulateTailSample — edge cases", () => {
  it("empty input is a no-op (no NaN)", () => {
    const sim = simulateTailSample([], { key: "trace_id", windowMs: 1000, keepPolicies: FULL_POLICY });
    expect(sim.totalTraces).toBe(0);
    expect(sim.keepRatio).toBe(0);
    expect(sim.spanReductionPercent).toBe(0);
    expect(sim.byteReductionPercent).toBe(0);
  });

  it("inert policy keeps everything (0% reduction)", () => {
    const { spans } = buildCorpus();
    const sim = simulateTailSample(spans, {
      key: "trace_id",
      windowMs: 1000,
      keepPolicies: { onError: false, slowThresholdMs: null, baselinePercent: 0 },
    });
    expect(sim.keptTraces).toBe(sim.totalTraces);
    expect(sim.droppedTraces).toBe(0);
    expect(sim.spanReductionPercent).toBe(0);
  });

  it("baselinePercent=100 keeps every trace", () => {
    const { spans } = buildCorpus();
    const sim = simulateTailSample(spans, {
      key: "trace_id",
      windowMs: 1000,
      keepPolicies: { onError: false, slowThresholdMs: null, baselinePercent: 100 },
    });
    expect(sim.keptTraces).toBe(sim.totalTraces);
    expect(sim.droppedSpans).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Config normalization                                             */
/* ------------------------------------------------------------------ */

describe("normalizeTailSampleConfig", () => {
  it("fills defaults from an empty config", () => {
    expect(normalizeTailSampleConfig({})).toEqual({
      key: "trace_id",
      windowMs: 30_000,
      keepPolicies: { onError: true, slowThresholdMs: null, baselinePercent: 10 },
    });
  });

  it("respects overrides and sanitises out-of-range values", () => {
    expect(
      normalizeTailSampleConfig({
        key: "spanContext.traceId",
        windowMs: 5000,
        keepPolicies: { onError: false, slowThresholdMs: 250, baselinePercent: 250 },
      }),
    ).toEqual({
      key: "spanContext.traceId",
      windowMs: 5000,
      keepPolicies: { onError: false, slowThresholdMs: 250, baselinePercent: 100 },
    });
  });

  it("treats non-positive window/threshold as unset", () => {
    const cfg = normalizeTailSampleConfig({
      windowMs: 0,
      keepPolicies: { onError: true, slowThresholdMs: -1, baselinePercent: -5 },
    });
    expect(cfg.windowMs).toBe(30_000);
    expect(cfg.keepPolicies.slowThresholdMs).toBeNull();
    expect(cfg.keepPolicies.baselinePercent).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Vector config generation                                         */
/* ------------------------------------------------------------------ */

describe("renderTailSampleBlocks", () => {
  const blocks = renderTailSampleBlocks(
    "ts",
    { key: "trace_id", windowMs: 30_000, keepPolicies: FULL_POLICY },
    ["src"],
  );

  it("expands to prepare → collect → keep-filter, keeping the node key last", () => {
    expect(Object.keys(blocks)).toEqual(["ts__tail_prepare", "ts__tail_collect", "ts"]);
  });

  it("prepare normalizes per-span signals from the incoming inputs", () => {
    const prepare = blocks["ts__tail_prepare"];
    expect(prepare.type).toBe("remap");
    expect(prepare.inputs).toEqual(["src"]);
    expect(prepare.source).toContain(".vf_span = .");
    expect(prepare.source).toContain(".vf_error");
    expect(prepare.source).toContain(".vf_duration_ms");
  });

  it("collect buffers by trace_id with span-collecting merge strategies", () => {
    const collect = blocks["ts__tail_collect"];
    expect(collect.type).toBe("reduce");
    expect(collect.inputs).toEqual(["ts__tail_prepare"]);
    expect(collect.group_by).toEqual(["trace_id"]);
    expect(collect.expire_after_ms).toBe(30_000);
    expect(collect.merge_strategies).toEqual({
      vf_error: "max",
      vf_duration_ms: "max",
      vf_span: "array",
    });
  });

  it("the keep-filter applies a VRL keep decision and drops the rest", () => {
    const filter = blocks["ts"];
    expect(filter.type).toBe("filter");
    expect(filter.inputs).toEqual(["ts__tail_collect"]);
    expect(filter.condition).toMatchObject({ type: "vrl" });
    const source = (filter.condition as { source: string }).source;
    expect(source).toContain("has_error");
    expect(source).toContain("is_slow");
    expect(source).toContain("in_baseline");
    expect(source).toContain("seahash");
  });
});

describe("buildTailSampleKeepVrl", () => {
  const base = { key: "trace_id", windowMs: 30_000 };

  it("includes only the enabled clauses, OR-ed together", () => {
    const vrl = buildTailSampleKeepVrl({ ...base, keepPolicies: FULL_POLICY });
    expect(vrl).toContain("has_error");
    expect(vrl).toContain("is_slow");
    expect(vrl).toContain("in_baseline");
    expect(vrl).toContain("has_error || is_slow || in_baseline");
  });

  it("omits the error clause when onError is off", () => {
    const vrl = buildTailSampleKeepVrl({
      ...base,
      keepPolicies: { onError: false, slowThresholdMs: 1000, baselinePercent: 10 },
    });
    expect(vrl).not.toContain("has_error");
    expect(vrl).toContain("is_slow || in_baseline");
  });

  it("omits the slow clause when no threshold is set", () => {
    const vrl = buildTailSampleKeepVrl({
      ...base,
      keepPolicies: { onError: true, slowThresholdMs: null, baselinePercent: 10 },
    });
    expect(vrl).not.toContain("is_slow");
  });

  it("omits the baseline clause when percent is 0", () => {
    const vrl = buildTailSampleKeepVrl({
      ...base,
      keepPolicies: { onError: true, slowThresholdMs: null, baselinePercent: 0 },
    });
    expect(vrl).not.toContain("in_baseline");
    expect(vrl).not.toContain("seahash");
  });

  it("stays inert (keep all) when no clause is enabled", () => {
    const vrl = buildTailSampleKeepVrl({
      ...base,
      keepPolicies: { onError: false, slowThresholdMs: null, baselinePercent: 0 },
    });
    expect(vrl).toBe("true");
  });
});
