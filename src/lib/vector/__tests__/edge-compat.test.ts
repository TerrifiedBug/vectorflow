import { describe, it, expect } from "vitest";
import {
  componentDataTypes,
  dataTypesCompatible,
  isReplacementCompatible,
} from "@/lib/vector/edge-compat";
import type { DataType } from "@/lib/vector/types";

function comp(inputTypes: DataType[], outputTypes: DataType[]) {
  return { inputTypes, outputTypes };
}

describe("componentDataTypes", () => {
  it("returns declared types per direction", () => {
    expect(componentDataTypes(comp(["metric"], ["log"]), "output")).toEqual(["log"]);
    expect(componentDataTypes(comp(["metric"], ["log"]), "input")).toEqual(["metric"]);
  });

  it("falls back to output types when input types are absent (type-agnostic transform)", () => {
    expect(
      componentDataTypes({ outputTypes: ["log", "metric"] }, "input"),
    ).toEqual(["log", "metric"]);
  });

  it("returns [] for an undefined component", () => {
    expect(componentDataTypes(undefined, "output")).toEqual([]);
  });
});

describe("dataTypesCompatible", () => {
  it("is permissive when either side is type-agnostic (empty)", () => {
    expect(dataTypesCompatible([], ["log"])).toBe(true);
    expect(dataTypesCompatible(["log"], [])).toBe(true);
  });

  it("requires an overlap when both sides declare types", () => {
    expect(dataTypesCompatible(["log"], ["log", "metric"])).toBe(true);
    expect(dataTypesCompatible(["log"], ["metric"])).toBe(false);
  });
});

describe("isReplacementCompatible", () => {
  const logSink = comp(["log"], ["log"]);
  const metricSink = comp(["metric"], ["metric"]);
  const anySink = comp(["log", "metric", "trace"], ["log", "metric", "trace"]);

  it("accepts a candidate compatible with every connected edge", () => {
    expect(
      isReplacementCompatible(logSink, { incomingOutputs: [["log"]], outgoingInputs: [] }),
    ).toBe(true);
    expect(
      isReplacementCompatible(anySink, {
        incomingOutputs: [["log"]],
        outgoingInputs: [["metric"]],
      }),
    ).toBe(true);
  });

  it("rejects a candidate that cannot accept an upstream neighbor's output", () => {
    // a metric-only sink fed by a log source
    expect(
      isReplacementCompatible(metricSink, { incomingOutputs: [["log"]], outgoingInputs: [] }),
    ).toBe(false);
  });

  it("rejects a candidate whose output a downstream neighbor cannot accept", () => {
    // a metric-producing transform feeding a log-only sink
    const metricTransform = comp(["log"], ["metric"]);
    expect(
      isReplacementCompatible(metricTransform, {
        incomingOutputs: [],
        outgoingInputs: [["log"]],
      }),
    ).toBe(false);
  });

  it("is permissive for an unconnected node (no edge constraints)", () => {
    expect(
      isReplacementCompatible(metricSink, { incomingOutputs: [], outgoingInputs: [] }),
    ).toBe(true);
  });
});
