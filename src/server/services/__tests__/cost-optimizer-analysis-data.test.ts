import { describe, it, expect } from "vitest";
import { detectLowReduction, detectHighErrorRate } from "@/server/services/cost-optimizer";
import type { PipelineAggregates } from "@/server/services/cost-optimizer-types";

describe("detectLowReduction analysis data", () => {
  it("includes targetSinkKey from sinkKeyMap", () => {
    const aggregates: PipelineAggregates[] = [
      {
        pipelineId: "pipe-1",
        pipelineName: "Test Pipeline",
        environmentId: "env-1",
        teamId: "team-1",
        totalBytesIn: BigInt(10_000_000_000),
        totalBytesOut: BigInt(9_900_000_000),
        totalEventsIn: BigInt(1_000_000),
        totalEventsOut: BigInt(990_000),
        totalErrors: BigInt(0),
        totalDiscarded: BigInt(0),
        metricCount: 100,
      },
    ];

    const sinkKeyMap = new Map([["pipe-1", "opensearch_prod"]]);
    const results = detectLowReduction(aggregates, undefined, sinkKeyMap);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("LOW_REDUCTION");
    expect(results[0].analysisData).toHaveProperty("targetSinkKey", "opensearch_prod");
  });

  it("defaults targetSinkKey to empty string when pipeline has no sinks", () => {
    const aggregates: PipelineAggregates[] = [
      {
        pipelineId: "pipe-2",
        pipelineName: "No Sink Pipeline",
        environmentId: "env-1",
        teamId: "team-1",
        totalBytesIn: BigInt(10_000_000_000),
        totalBytesOut: BigInt(9_900_000_000),
        totalEventsIn: BigInt(1_000_000),
        totalEventsOut: BigInt(990_000),
        totalErrors: BigInt(0),
        totalDiscarded: BigInt(0),
        metricCount: 100,
      },
    ];

    const results = detectLowReduction(aggregates, undefined, new Map());
    expect(results).toHaveLength(1);
    expect(results[0].analysisData).toHaveProperty("targetSinkKey", "");
  });
});

describe("detectHighErrorRate analysis data", () => {
  it("includes targetSinkKey from sinkKeyMap", () => {
    const aggregates: PipelineAggregates[] = [
      {
        pipelineId: "pipe-1",
        pipelineName: "Error Pipeline",
        environmentId: "env-1",
        teamId: "team-1",
        totalBytesIn: BigInt(5_000_000_000),
        totalBytesOut: BigInt(4_000_000_000),
        totalEventsIn: BigInt(1000),
        totalEventsOut: BigInt(800),
        totalErrors: BigInt(150),
        totalDiscarded: BigInt(50),
        metricCount: 50,
      },
    ];

    const sinkKeyMap = new Map([["pipe-1", "splunk_sink"]]);
    const results = detectHighErrorRate(aggregates, undefined, sinkKeyMap);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("HIGH_ERROR_RATE");
    expect(results[0].analysisData).toHaveProperty("targetSinkKey", "splunk_sink");
  });
});
