import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import {
  buildNdjson,
  parseVrlOutputs,
  computeReductionStats,
  evaluateVrl,
} from "../transform-eval";

function vectorAvailable(): boolean {
  try {
    execFileSync("vector", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const hasVector = vectorAvailable();

describe("transform-eval pure helpers", () => {
  it("buildNdjson emits one compact JSON line per event", () => {
    expect(buildNdjson([{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n{"b":2}');
    expect(buildNdjson([])).toBe("");
  });

  it("parseVrlOutputs keeps JSON objects and ignores aborted/banner lines", () => {
    const stdout = 'INFO vector::app banner line\n{ "a": 1 }\naborted\n{ "b": 2 }\n';
    expect(parseVrlOutputs(stdout)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("computeReductionStats derives drops + reduction percentages", () => {
    const stats = computeReductionStats({
      inputCount: 4,
      outputCount: 1,
      inputBytes: 400,
      outputBytes: 100,
    });
    expect(stats.droppedCount).toBe(3);
    expect(stats.eventReductionPercent).toBe(75);
    expect(stats.byteReductionPercent).toBe(75);
  });

  it("computeReductionStats returns 0% (not NaN) for empty input", () => {
    const stats = computeReductionStats({
      inputCount: 0,
      outputCount: 0,
      inputBytes: 0,
      outputBytes: 0,
    });
    expect(stats.eventReductionPercent).toBe(0);
    expect(stats.byteReductionPercent).toBe(0);
  });
});

describe("evaluateVrl no-op fast paths (no binary needed)", () => {
  it("empty program passes every event through unchanged", async () => {
    const result = await evaluateVrl("", [{ a: 1 }, { b: 2 }]);
    expect(result.outputCount).toBe(2);
    expect(result.droppedCount).toBe(0);
    expect(result.outputs).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("empty event set is a no-op", async () => {
    const result = await evaluateVrl(".x = 1", []);
    expect(result.inputCount).toBe(0);
    expect(result.outputCount).toBe(0);
    expect(result.eventReductionPercent).toBe(0);
  });
});

describe.skipIf(!hasVector)("evaluateVrl against the vector binary", () => {
  it("counts aborted events as drops and applies the transform to survivors", async () => {
    const events = [
      { keep: true, msg: "a" },
      { keep: false, msg: "b" },
      { keep: true, msg: "c" },
    ];
    const result = await evaluateVrl("if .keep != true { abort }\n.processed = true", events);
    expect(result.error).toBeUndefined();
    expect(result.inputCount).toBe(3);
    expect(result.outputCount).toBe(2);
    expect(result.droppedCount).toBe(1);
    expect(result.eventReductionPercent).toBeCloseTo(33.33, 1);
    expect((result.outputs[0] as { processed?: boolean }).processed).toBe(true);
  });

  it("a no-op transform keeps all events", async () => {
    const result = await evaluateVrl(".x = 1", [{ a: 1 }, { b: 2 }]);
    expect(result.outputCount).toBe(2);
    expect(result.droppedCount).toBe(0);
  });

  it("a compile error surfaces in result.error rather than throwing", async () => {
    const result = await evaluateVrl("@@ not valid vrl @@", [{ a: 1 }]);
    expect(result.error).toBeTruthy();
    expect(result.outputCount).toBe(0);
  });
});
