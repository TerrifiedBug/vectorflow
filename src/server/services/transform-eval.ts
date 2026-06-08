// Transform-evaluation harness — run a VRL program against a *set* of events and
// return the transformed outputs plus reduction statistics (kept/dropped, byte
// reduction). This is the multi-event generalisation of `vrl.test`
// (src/server/routers/vrl.ts), shared by:
//   - cost what-if simulation (project a transform's reduction before apply)
//   - the live-tap iteration loop (test a VRL change against the last N real events)
//   - trace tail-sampling preview (kept/dropped ratios on real sampled traces)
//
// Events can come from anywhere (pasted JSON, a persisted tap capture, a lake
// query) — callers pass a plain array; this module only cares about the
// evaluation + stats. Execution shells out to the `vector` binary exactly like
// `vrl.test`; when `vector` is absent the result carries an `error` and zeroed
// outputs rather than throwing, so callers degrade gracefully.

import { writeFile, unlink, mkdtemp } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { withOrgConcurrencyLimit } from "@/lib/org-concurrency";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Max concurrent `vector` subprocesses per org (bucket key `"vector-eval"`).
 * Conservative: enough for an interactive editor's parallel unit-test batch
 * without letting one tenant monopolize the shared host.
 */
const VECTOR_EVAL_CONCURRENCY = 4;

export interface TransformEvalStats {
  /** Events fed in. */
  inputCount: number;
  /** Events that survived the transform (a VRL `abort` drops the event). */
  outputCount: number;
  /** inputCount - outputCount. */
  droppedCount: number;
  /** Byte size of the NDJSON input. */
  inputBytes: number;
  /** Byte size of the NDJSON output. */
  outputBytes: number;
  /** (in - out) / in * 100, rounded to 2dp. 0 when no input. */
  eventReductionPercent: number;
  /** (inBytes - outBytes) / inBytes * 100, rounded to 2dp. 0 when no input. */
  byteReductionPercent: number;
}

export interface TransformEvalResult extends TransformEvalStats {
  /** Parsed output events (one per surviving input event). */
  outputs: unknown[];
  /** Present when evaluation failed (compile error, missing binary, timeout). */
  error?: string;
  durationMs: number;
}

export interface EvaluateVrlOptions {
  timeoutMs?: number;
  /**
   * Organization to bound the `vector` subprocess spawn under (see
   * `withOrgConcurrencyLimit`). Omit to run unbounded (backward-compatible).
   */
  orgId?: string;
}

/** NDJSON encoding for `vector vrl --input` (one compact JSON object per line). */
export function buildNdjson(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

/**
 * Parse `vector vrl --print-object` stdout. One JSON object per surviving event;
 * dropped events emit a non-JSON `aborted` line, and (depending on log config) a
 * banner line may appear — both are ignored, so the parsed count equals the
 * number of surviving events.
 */
export function parseVrlOutputs(stdout: string): unknown[] {
  const outputs: unknown[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line || !(line.startsWith("{") || line.startsWith("["))) continue;
    try {
      outputs.push(JSON.parse(line));
    } catch {
      // Non-JSON line (e.g. a log banner) — not an output event.
    }
  }
  return outputs;
}

/** Pure reduction-stats computation (no I/O) — the unit-testable core. */
export function computeReductionStats(args: {
  inputCount: number;
  outputCount: number;
  inputBytes: number;
  outputBytes: number;
}): TransformEvalStats {
  const { inputCount, outputCount, inputBytes, outputBytes } = args;
  return {
    inputCount,
    outputCount,
    droppedCount: Math.max(0, inputCount - outputCount),
    inputBytes,
    outputBytes,
    eventReductionPercent:
      inputCount > 0 ? Math.round(((inputCount - outputCount) / inputCount) * 10000) / 100 : 0,
    byteReductionPercent:
      inputBytes > 0 ? Math.round(((inputBytes - outputBytes) / inputBytes) * 10000) / 100 : 0,
  };
}

function resultFromOutputs(
  inputCount: number,
  inputBytes: number,
  outputs: unknown[],
  durationMs: number,
  error?: string,
): TransformEvalResult {
  const outputBytes = outputs.length > 0 ? Buffer.byteLength(buildNdjson(outputs), "utf8") : 0;
  return {
    ...computeReductionStats({
      inputCount,
      outputCount: outputs.length,
      inputBytes,
      outputBytes,
    }),
    outputs,
    error,
    durationMs,
  };
}

/**
 * Spawn the `vector` subprocess for a non-trivial program/input pair: write the
 * program + NDJSON to a temp dir, run `vector vrl`, parse the surviving events.
 * Never throws — compile errors, a missing binary, or a timeout land in
 * `result.error`. Temp files are always cleaned up.
 */
async function runVectorEval(
  source: string,
  ndjson: string,
  inputCount: number,
  inputBytes: number,
  start: number,
  timeoutMs: number,
): Promise<TransformEvalResult> {
  let tmpDir: string;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "vf-transform-eval-"));
  } catch {
    return resultFromOutputs(inputCount, inputBytes, [], 0, "Failed to create temporary directory");
  }

  const programPath = join(tmpDir, "program.vrl");
  const inputPath = join(tmpDir, "input.json");

  try {
    await writeFile(programPath, source);
    await writeFile(inputPath, ndjson);

    const { stdout } = await execFileAsync(
      "vector",
      ["vrl", "--input", inputPath, "--program", programPath, "--print-object"],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env: { ...process.env, VECTOR_LOG: "error" },
      },
    );

    const durationMs = Math.round(performance.now() - start);
    return resultFromOutputs(inputCount, inputBytes, parseVrlOutputs(stdout), durationMs);
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const execErr = err as NodeJS.ErrnoException & { stderr?: string };
    const error =
      execErr.code === "ENOENT"
        ? "VRL evaluation requires the vector binary. Install Vector (https://vector.dev) to use this feature."
        : execErr.stderr?.trim() || execErr.message || "Unknown error running VRL";
    return resultFromOutputs(inputCount, inputBytes, [], durationMs, error);
  } finally {
    await unlink(programPath).catch(() => {});
    await unlink(inputPath).catch(() => {});
  }
}

/**
 * Run a VRL program over `events`, returning transformed outputs + reduction
 * stats. An empty program or empty input is a no-op pass-through (0% reduction).
 * Never throws — failures land in `result.error`.
 *
 * When `options.orgId` is set, the `vector` subprocess spawn is bounded per org
 * (key `"vector-eval"`) so one tenant's concurrent evals (live-tap, cost
 * what-if, unit-test "run all") cannot starve the shared host. The no-op fast
 * path never takes a slot, and behavior is unchanged when `orgId` is omitted.
 */
export async function evaluateVrl(
  source: string,
  events: unknown[],
  options: EvaluateVrlOptions = {},
): Promise<TransformEvalResult> {
  const start = performance.now();
  const inputCount = events.length;
  const ndjson = buildNdjson(events);
  const inputBytes = Buffer.byteLength(ndjson, "utf8");

  if (!source.trim() || inputCount === 0) {
    return resultFromOutputs(inputCount, inputBytes, [...events], 0);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = () => runVectorEval(source, ndjson, inputCount, inputBytes, start, timeoutMs);

  return options.orgId
    ? withOrgConcurrencyLimit(options.orgId, "vector-eval", VECTOR_EVAL_CONCURRENCY, run)
    : run();
}
