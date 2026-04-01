import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  PrometheusMetricsService,
  bigIntToNumber,
} from "@/server/services/prometheus-metrics";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function nps(overrides: {
  nodeId?: string;
  pipelineId?: string;
  status?: string;
  eventsIn?: number;
  eventsOut?: number;
  errorsTotal?: number;
  eventsDiscarded?: number;
  bytesIn?: number;
  bytesOut?: number;
  utilization?: number;
}) {
  return {
    nodeId: overrides.nodeId ?? "node-1",
    pipelineId: overrides.pipelineId ?? "pipe-1",
    status: overrides.status ?? "RUNNING",
    eventsIn: BigInt(overrides.eventsIn ?? 0),
    eventsOut: BigInt(overrides.eventsOut ?? 0),
    errorsTotal: BigInt(overrides.errorsTotal ?? 0),
    eventsDiscarded: BigInt(overrides.eventsDiscarded ?? 0),
    bytesIn: BigInt(overrides.bytesIn ?? 0),
    bytesOut: BigInt(overrides.bytesOut ?? 0),
    utilization: overrides.utilization ?? 0,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("bigIntToNumber", () => {
  it("converts normal BigInt values", () => {
    expect(bigIntToNumber(BigInt(42))).toBe(42);
    expect(bigIntToNumber(BigInt(0))).toBe(0);
    expect(bigIntToNumber(BigInt(-100))).toBe(-100);
  });

  it("saturates at MAX_SAFE_INTEGER for large values", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1000);
    expect(bigIntToNumber(huge)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("saturates at MIN_SAFE_INTEGER for large negative values", () => {
    const negHuge = BigInt(Number.MIN_SAFE_INTEGER) - BigInt(1000);
    expect(bigIntToNumber(negHuge)).toBe(Number.MIN_SAFE_INTEGER);
  });
});

describe("PrometheusMetricsService", () => {
  let service: PrometheusMetricsService;

  beforeEach(() => {
    mockReset(prismaMock);
    service = new PrometheusMetricsService();
  });

  it("returns valid empty output when no data exists", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    const output = await service.collectMetrics();
    // Should be empty or contain only HELP/TYPE lines with no samples
    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    // No actual metric lines (no node_id labels)
    expect(output).not.toContain('node_id="');
  });

  it("populates node status gauges with correct labels", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      {
        id: "n1",
        name: "prod-node",
        environmentId: "env-1",
        status: "HEALTHY",
      } as never,
    ]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    const output = await service.collectMetrics();
    expect(output).toContain("vectorflow_node_status");
    expect(output).toContain('node_id="n1"');
    expect(output).toContain('node_name="prod-node"');
    expect(output).toContain('environment_id="env-1"');
    // HEALTHY = 1
    expect(output).toMatch(/vectorflow_node_status\{[^}]*\} 1/);
  });

  it("maps all node status values correctly", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "n1", name: "a", environmentId: "e", status: "HEALTHY" } as never,
      { id: "n2", name: "b", environmentId: "e", status: "DEGRADED" } as never,
      {
        id: "n3",
        name: "c",
        environmentId: "e",
        status: "UNREACHABLE",
      } as never,
      { id: "n4", name: "d", environmentId: "e", status: "UNKNOWN" } as never,
    ]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    const output = await service.collectMetrics();
    expect(output).toMatch(/node_id="n1"[^}]*\} 1/);
    expect(output).toMatch(/node_id="n2"[^}]*\} 2/);
    expect(output).toMatch(/node_id="n3"[^}]*\} 3/);
    expect(output).toMatch(/node_id="n4"[^}]*\} 0/);
  });

  it("populates pipeline status and counter gauges", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({
        nodeId: "n1",
        pipelineId: "p1",
        status: "RUNNING",
        eventsIn: 1000,
        eventsOut: 950,
        errorsTotal: 5,
        eventsDiscarded: 10,
        bytesIn: 50000,
        bytesOut: 48000,
        utilization: 0.75,
      }) as never,
    ]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    const output = await service.collectMetrics();
    expect(output).toContain("vectorflow_pipeline_status");
    expect(output).toContain("vectorflow_pipeline_events_in_total");
    expect(output).toContain("vectorflow_pipeline_events_out_total");
    expect(output).toContain("vectorflow_pipeline_errors_total");
    expect(output).toContain("vectorflow_pipeline_bytes_in_total");
    expect(output).toContain("vectorflow_pipeline_utilization");

    // Check RUNNING = 1
    expect(output).toMatch(
      /vectorflow_pipeline_status\{node_id="n1",pipeline_id="p1"\} 1/,
    );
    expect(output).toMatch(
      /vectorflow_pipeline_events_in_total\{node_id="n1",pipeline_id="p1"\} 1000/,
    );
    expect(output).toMatch(
      /vectorflow_pipeline_errors_total\{node_id="n1",pipeline_id="p1"\} 5/,
    );
    expect(output).toMatch(
      /vectorflow_pipeline_utilization\{node_id="n1",pipeline_id="p1"\} 0.75/,
    );
  });

  it("maps all pipeline process status values correctly", async () => {
    const statuses = [
      { status: "RUNNING", expected: 1 },
      { status: "STARTING", expected: 2 },
      { status: "STOPPED", expected: 3 },
      { status: "CRASHED", expected: 4 },
      { status: "PENDING", expected: 0 },
    ];

    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue(
      statuses.map((s, i) =>
        nps({
          nodeId: `n${i}`,
          pipelineId: `p${i}`,
          status: s.status,
        }),
      ) as never,
    );
    prismaMock.$queryRaw.mockResolvedValue([]);

    const output = await service.collectMetrics();
    for (const s of statuses) {
      const idx = statuses.indexOf(s);
      expect(output).toMatch(
        new RegExp(
          `vectorflow_pipeline_status\\{node_id="n${idx}",pipeline_id="p${idx}"\\} ${s.expected}`,
        ),
      );
    }
  });

  it("handles BigInt values near MAX_SAFE_INTEGER", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({
        nodeId: "n1",
        pipelineId: "p1",
        eventsIn: Number.MAX_SAFE_INTEGER,
      }) as never,
    ]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    const output = await service.collectMetrics();
    expect(output).toContain(
      `vectorflow_pipeline_events_in_total{node_id="n1",pipeline_id="p1"} ${Number.MAX_SAFE_INTEGER}`,
    );
  });

  it("populates latency gauge when latencyMeanMs is non-null", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([
      { pipelineId: "p1", nodeId: "n1", latencyMeanMs: 42.5 },
    ]);

    const output = await service.collectMetrics();
    expect(output).toContain("vectorflow_pipeline_latency_mean_ms");
    expect(output).toMatch(
      /vectorflow_pipeline_latency_mean_ms\{pipeline_id="p1",node_id="n1"\} 42.5/,
    );
  });

  it("skips latency gauge when latencyMeanMs is null", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([
      { pipelineId: "p1", nodeId: "n1", latencyMeanMs: null },
    ]);

    const output = await service.collectMetrics();
    // Should not have a metric line for p1 latency
    expect(output).not.toMatch(
      /vectorflow_pipeline_latency_mean_ms\{pipeline_id="p1"/,
    );
  });

  it("handles null nodeId in latency metric", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([
      { pipelineId: "p1", nodeId: null, latencyMeanMs: 10 },
    ]);

    const output = await service.collectMetrics();
    expect(output).toMatch(
      /vectorflow_pipeline_latency_mean_ms\{pipeline_id="p1",node_id=""\} 10/,
    );
  });

  it("returns stale/empty metrics on DB error without throwing", async () => {
    prismaMock.vectorNode.findMany.mockRejectedValue(
      new Error("DB connection failed"),
    );
    prismaMock.nodePipelineStatus.findMany.mockRejectedValue(
      new Error("DB connection failed"),
    );
    prismaMock.$queryRaw.mockRejectedValue(
      new Error("DB connection failed"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const output = await service.collectMetrics();
    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    expect(consoleSpy).toHaveBeenCalledWith(
      "%s [%s] %s",
      expect.any(String),
      "prometheus-metrics",
      "collectMetrics failed",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("clears stale data on second collect when node/pipeline removed", async () => {
    // First collect: node and pipeline exist
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "n1", name: "a", environmentId: "e", status: "HEALTHY" } as never,
    ]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({ nodeId: "n1", pipelineId: "p1", eventsIn: 100 }) as never,
    ]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    let output = await service.collectMetrics();
    expect(output).toContain('node_id="n1"');
    expect(output).toContain('pipeline_id="p1"');

    // Second collect: everything removed
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    output = await service.collectMetrics();
    // Old labels should be gone
    expect(output).not.toContain('node_id="n1"');
    expect(output).not.toContain('pipeline_id="p1"');
  });

  it("handles multiple nodes and pipelines simultaneously", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "n1", name: "a", environmentId: "e", status: "HEALTHY" } as never,
      {
        id: "n2",
        name: "b",
        environmentId: "e",
        status: "DEGRADED",
      } as never,
    ]);
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      nps({
        nodeId: "n1",
        pipelineId: "p1",
        eventsIn: 100,
      }) as never,
      nps({
        nodeId: "n1",
        pipelineId: "p2",
        eventsIn: 200,
      }) as never,
      nps({
        nodeId: "n2",
        pipelineId: "p1",
        eventsIn: 300,
      }) as never,
    ]);
    prismaMock.$queryRaw.mockResolvedValue([
      { pipelineId: "p1", nodeId: "n1", latencyMeanMs: 5.0 },
      { pipelineId: "p2", nodeId: "n1", latencyMeanMs: 12.0 },
    ]);

    const output = await service.collectMetrics();
    // Should have both nodes
    expect(output).toContain('node_id="n1"');
    expect(output).toContain('node_id="n2"');
    // Should have all 3 pipeline statuses
    expect(output).toMatch(
      /vectorflow_pipeline_events_in_total\{node_id="n1",pipeline_id="p1"\} 100/,
    );
    expect(output).toMatch(
      /vectorflow_pipeline_events_in_total\{node_id="n1",pipeline_id="p2"\} 200/,
    );
    expect(output).toMatch(
      /vectorflow_pipeline_events_in_total\{node_id="n2",pipeline_id="p1"\} 300/,
    );
    // Should have latency for p1 and p2 on n1
    expect(output).toMatch(
      /vectorflow_pipeline_latency_mean_ms\{pipeline_id="p1",node_id="n1"\} 5/,
    );
    expect(output).toMatch(
      /vectorflow_pipeline_latency_mean_ms\{pipeline_id="p2",node_id="n1"\} 12/,
    );
  });

  it("exposes registry via getRegistry()", () => {
    const registry = service.getRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.metrics).toBe("function");
  });
});
