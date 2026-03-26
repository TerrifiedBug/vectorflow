import { describe, it, expect } from "vitest";
import { getInvalidationKeys } from "../use-realtime-invalidation";

describe("getInvalidationKeys", () => {
  it("maps metric_update to 12 query key prefixes", () => {
    const keys = getInvalidationKeys("metric_update");
    expect(keys).toHaveLength(12);
    expect(keys).toContainEqual(["dashboard", "stats"]);
    expect(keys).toContainEqual(["dashboard", "pipelineCards"]);
    expect(keys).toContainEqual(["dashboard", "chartMetrics"]);
    expect(keys).toContainEqual(["dashboard", "volumeAnalytics"]);
    expect(keys).toContainEqual(["metrics", "getNodePipelineRates"]);
    expect(keys).toContainEqual(["fleet", "nodeMetrics"]);
    expect(keys).toContainEqual(["fleet", "overview"]);
    expect(keys).toContainEqual(["fleet", "volumeTrend"]);
    expect(keys).toContainEqual(["fleet", "nodeThroughput"]);
    expect(keys).toContainEqual(["fleet", "nodeCapacity"]);
    expect(keys).toContainEqual(["fleet", "dataLoss"]);
    expect(keys).toContainEqual(["fleet", "matrixThroughput"]);
  });

  it("maps fleet_status to 7 query key prefixes", () => {
    const keys = getInvalidationKeys("fleet_status");
    expect(keys).toHaveLength(7);
    expect(keys).toContainEqual(["dashboard", "stats"]);
    expect(keys).toContainEqual(["dashboard", "pipelineCards"]);
    expect(keys).toContainEqual(["fleet", "list"]);
    expect(keys).toContainEqual(["fleet", "get"]);
    expect(keys).toContainEqual(["fleet", "listWithPipelineStatus"]);
    expect(keys).toContainEqual(["fleet", "getUptime"]);
    expect(keys).toContainEqual(["fleet", "getStatusTimeline"]);
  });

  it("maps status_change to 4 query key prefixes", () => {
    const keys = getInvalidationKeys("status_change");
    expect(keys).toHaveLength(4);
    expect(keys).toContainEqual(["dashboard", "pipelineCards"]);
    expect(keys).toContainEqual(["fleet", "list"]);
    expect(keys).toContainEqual(["fleet", "get"]);
    expect(keys).toContainEqual(["fleet", "listWithPipelineStatus"]);
  });

  it("maps log_entry to 2 query key prefixes for log streaming", () => {
    const keys = getInvalidationKeys("log_entry");
    expect(keys).toHaveLength(2);
    expect(keys).toContainEqual(["pipeline", "logs"]);
    expect(keys).toContainEqual(["fleet", "nodeLogs"]);
  });

  it("returns empty array for unknown event type", () => {
    // Cast to bypass type checking for exhaustiveness test
    const keys = getInvalidationKeys("unknown_type" as never);
    expect(keys).toHaveLength(0);
  });

  it("all returned keys are 2-element string arrays (tRPC format)", () => {
    const eventTypes = [
      "metric_update",
      "fleet_status",
      "status_change",
      "log_entry",
    ] as const;

    for (const eventType of eventTypes) {
      const keys = getInvalidationKeys(eventType);
      for (const key of keys) {
        expect(key).toHaveLength(2);
        expect(typeof key[0]).toBe("string");
        expect(typeof key[1]).toBe("string");
      }
    }
  });
});
