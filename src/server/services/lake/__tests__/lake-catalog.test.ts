import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MetricsDataPoint, PreviousSnapshot } from "@/server/services/metrics-ingest";

// @clickhouse/client is an optional native dep absent from some dev installs;
// stub it so the real clickhouse.ts loads (isLakeEnabled reads env only — this
// suite toggles VF_LAKE_CLICKHOUSE_URL rather than mocking the module).
vi.mock("@clickhouse/client", () => ({ createClient: vi.fn() }));

// Shared prisma mock, hoisted so the vi.mock factories can reference it.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lakeDataset: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    pipeline: { findMany: vi.fn() },
    pipelineNode: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  basePrisma: prismaMock,
  adminPrisma: prismaMock,
}));

// withOrgTx runs its callback with a tenant-scoped tx; here the tx IS the prisma
// mock so assertions can inspect the catalog writes directly.
vi.mock("@/lib/with-org-tx", () => ({
  withOrgTx: vi.fn(
    async (_orgId: string, fn: (tx: typeof prismaMock) => Promise<unknown>) =>
      fn(prismaMock),
  ),
}));

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  debugLog: vi.fn(),
}));

import { withOrgTx } from "@/lib/with-org-tx";
import {
  upsertLakeDataset,
  recordLakeIngest,
  updateLakeCatalogFromHeartbeat,
  attachLakeSinkOutput,
} from "../lake-catalog";

const KEY = {
  where: { organizationId_pipelineId: { organizationId: "org-1", pipelineId: "pipe-1" } },
};

function updateData(): Record<string, unknown> {
  return (prismaMock.lakeDataset.update.mock.calls[0][0] as { data: Record<string, unknown> })
    .data;
}

function dataPoint(pipelineId: string, o: Partial<MetricsDataPoint> = {}): MetricsDataPoint {
  return {
    nodeId: "node-1",
    pipelineId,
    eventsIn: BigInt(0),
    eventsOut: BigInt(0),
    errorsTotal: BigInt(0),
    eventsDiscarded: BigInt(0),
    bytesIn: BigInt(0),
    bytesOut: BigInt(0),
    utilization: 0,
    latencyMeanMs: null,
    ...o,
  };
}

function snapshot(o: Partial<PreviousSnapshot> = {}): PreviousSnapshot {
  return {
    eventsIn: BigInt(0),
    eventsOut: BigInt(0),
    errorsTotal: BigInt(0),
    eventsDiscarded: BigInt(0),
    bytesIn: BigInt(0),
    bytesOut: BigInt(0),
    ...o,
  };
}

const LAKE_YAML =
  "sinks:\n  lake:\n    type: clickhouse\n    endpoint: LAKE[endpoint]\n    table: lake_events\n    inputs:\n      - in\n";
const NON_LAKE_YAML = "sinks:\n  out:\n    type: console\n    encoding:\n      codec: json\n";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VF_LAKE_CLICKHOUSE_URL;
});

describe("upsertLakeDataset", () => {
  it("upserts the catalog row inside a tenant transaction", async () => {
    prismaMock.lakeDataset.upsert.mockResolvedValue({});

    await upsertLakeDataset({ orgId: "org-1", pipelineId: "pipe-1", environmentId: "env-1" });

    expect(withOrgTx).toHaveBeenCalledWith("org-1", expect.any(Function));
    expect(prismaMock.lakeDataset.upsert).toHaveBeenCalledWith({
      ...KEY,
      create: { organizationId: "org-1", pipelineId: "pipe-1", environmentId: "env-1" },
      update: { environmentId: "env-1" },
    });
  });
});

describe("recordLakeIngest", () => {
  it("adds to counts, widens the time range and merges schema", async () => {
    prismaMock.lakeDataset.findUnique.mockResolvedValue({
      rowCount: BigInt(100),
      byteCount: BigInt(1000),
      firstEventAt: new Date("2026-06-01T00:00:00Z"),
      lastEventAt: new Date("2026-06-02T00:00:00Z"),
      schemaJson: { existing_field: "string" },
    });
    prismaMock.lakeDataset.update.mockResolvedValue({});

    await recordLakeIngest({
      orgId: "org-1",
      pipelineId: "pipe-1",
      rowsAdded: BigInt(5),
      bytesAdded: BigInt(50),
      firstEventAt: new Date("2026-05-31T00:00:00Z"),
      lastEventAt: new Date("2026-06-03T00:00:00Z"),
      schema: { new_field: "int64" },
    });

    const data = updateData();
    expect(data.rowCount).toBe(BigInt(105));
    expect(data.byteCount).toBe(BigInt(1050));
    expect(data.firstEventAt).toEqual(new Date("2026-05-31T00:00:00Z"));
    expect(data.lastEventAt).toEqual(new Date("2026-06-03T00:00:00Z"));
    expect(data.schemaJson).toEqual({ existing_field: "string", new_field: "int64" });
  });

  it("keeps the existing time range when new events fall inside it", async () => {
    const first = new Date("2026-06-01T00:00:00Z");
    const last = new Date("2026-06-10T00:00:00Z");
    prismaMock.lakeDataset.findUnique.mockResolvedValue({
      rowCount: BigInt(0),
      byteCount: BigInt(0),
      firstEventAt: first,
      lastEventAt: last,
      schemaJson: null,
    });
    prismaMock.lakeDataset.update.mockResolvedValue({});

    await recordLakeIngest({
      orgId: "org-1",
      pipelineId: "pipe-1",
      rowsAdded: BigInt(1),
      bytesAdded: BigInt(1),
      firstEventAt: new Date("2026-06-05T00:00:00Z"),
      lastEventAt: new Date("2026-06-06T00:00:00Z"),
    });

    const data = updateData();
    expect(data.firstEventAt).toBe(first);
    expect(data.lastEventAt).toBe(last);
  });

  it("initializes the time range from null bounds", async () => {
    const now = new Date("2026-06-05T12:00:00Z");
    prismaMock.lakeDataset.findUnique.mockResolvedValue({
      rowCount: BigInt(0),
      byteCount: BigInt(0),
      firstEventAt: null,
      lastEventAt: null,
      schemaJson: null,
    });
    prismaMock.lakeDataset.update.mockResolvedValue({});

    await recordLakeIngest({
      orgId: "org-1",
      pipelineId: "pipe-1",
      rowsAdded: BigInt(3),
      bytesAdded: BigInt(30),
      firstEventAt: now,
      lastEventAt: now,
    });

    const data = updateData();
    expect(data.firstEventAt).toBe(now);
    expect(data.lastEventAt).toBe(now);
  });

  it("does not write schemaJson when no schema is supplied", async () => {
    prismaMock.lakeDataset.findUnique.mockResolvedValue({
      rowCount: BigInt(0),
      byteCount: BigInt(0),
      firstEventAt: null,
      lastEventAt: null,
      schemaJson: { a: "string" },
    });
    prismaMock.lakeDataset.update.mockResolvedValue({});

    await recordLakeIngest({
      orgId: "org-1",
      pipelineId: "pipe-1",
      rowsAdded: BigInt(1),
      bytesAdded: BigInt(1),
    });

    expect(updateData()).not.toHaveProperty("schemaJson");
  });

  it("skips the update when the catalog row does not exist yet", async () => {
    prismaMock.lakeDataset.findUnique.mockResolvedValue(null);

    await recordLakeIngest({
      orgId: "org-1",
      pipelineId: "pipe-1",
      rowsAdded: BigInt(5),
      bytesAdded: BigInt(50),
    });

    expect(prismaMock.lakeDataset.update).not.toHaveBeenCalled();
  });
});

describe("updateLakeCatalogFromHeartbeat", () => {
  it("is a no-op when the lake is disabled", async () => {
    await updateLakeCatalogFromHeartbeat({
      orgId: "org-1",
      environmentId: "env-1",
      dataPoints: [dataPoint("pipe-1", { eventsOut: BigInt(10), bytesOut: BigInt(100) })],
      previousSnapshots: new Map(),
    });

    expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
    expect(prismaMock.lakeDataset.upsert).not.toHaveBeenCalled();
  });

  it("records the Lake sink's write delta for a Lake-routed pipeline", async () => {
    process.env.VF_LAKE_CLICKHOUSE_URL = "http://clickhouse:8123";
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", versions: [{ configYaml: LAKE_YAML }] },
    ]);
    prismaMock.lakeDataset.upsert.mockResolvedValue({});
    prismaMock.lakeDataset.findUnique.mockResolvedValue({
      rowCount: BigInt(0),
      byteCount: BigInt(0),
      firstEventAt: null,
      lastEventAt: null,
      schemaJson: null,
    });
    prismaMock.lakeDataset.update.mockResolvedValue({});

    const previousSnapshots = new Map<string, PreviousSnapshot>([
      ["node-1:pipe-1", snapshot({ eventsOut: BigInt(4), bytesOut: BigInt(40) })],
    ]);

    await updateLakeCatalogFromHeartbeat({
      orgId: "org-1",
      environmentId: "env-1",
      dataPoints: [
        dataPoint("pipe-1", {
          eventsOut: BigInt(10),
          bytesOut: BigInt(100),
          lakeEventsOut: BigInt(10),
          lakeBytesOut: BigInt(100),
        }),
      ],
      previousSnapshots,
    });

    expect(prismaMock.lakeDataset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { organizationId: "org-1", pipelineId: "pipe-1", environmentId: "env-1" },
      }),
    );
    const data = updateData();
    expect(data.rowCount).toBe(BigInt(6)); // Lake-only delta: clamp(10, 4)
    expect(data.byteCount).toBe(BigInt(60)); // Lake-only delta: clamp(100, 40)
  });

  it("records only the Lake sink's share, not the whole pipeline output", async () => {
    process.env.VF_LAKE_CLICKHOUSE_URL = "http://clickhouse:8123";
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", versions: [{ configYaml: LAKE_YAML }] },
    ]);
    prismaMock.lakeDataset.upsert.mockResolvedValue({});
    prismaMock.lakeDataset.findUnique.mockResolvedValue({
      rowCount: BigInt(0),
      byteCount: BigInt(0),
      firstEventAt: null,
      lastEventAt: null,
      schemaJson: null,
    });
    prismaMock.lakeDataset.update.mockResolvedValue({});

    await updateLakeCatalogFromHeartbeat({
      orgId: "org-1",
      environmentId: "env-1",
      // Pipeline output delta: events clamp(10,4)=6, bytes clamp(100,40)=60. The
      // Lake is half the cumulative output, so only 3 rows / 30 bytes are its own.
      dataPoints: [
        dataPoint("pipe-1", {
          eventsOut: BigInt(10),
          bytesOut: BigInt(100),
          lakeEventsOut: BigInt(5),
          lakeBytesOut: BigInt(50),
        }),
      ],
      previousSnapshots: new Map([
        ["node-1:pipe-1", snapshot({ eventsOut: BigInt(4), bytesOut: BigInt(40) })],
      ]),
    });

    const data = updateData();
    expect(data.rowCount).toBe(BigInt(3)); // 6 * 5/10
    expect(data.byteCount).toBe(BigInt(30)); // 60 * 50/100
  });

  it("skips pipelines that do not route to the lake", async () => {
    process.env.VF_LAKE_CLICKHOUSE_URL = "http://clickhouse:8123";
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", versions: [{ configYaml: NON_LAKE_YAML }] },
    ]);

    await updateLakeCatalogFromHeartbeat({
      orgId: "org-1",
      environmentId: "env-1",
      dataPoints: [dataPoint("pipe-1", { eventsOut: BigInt(10), bytesOut: BigInt(100) })],
      previousSnapshots: new Map([
        ["node-1:pipe-1", snapshot({ eventsOut: BigInt(4), bytesOut: BigInt(40) })],
      ]),
    });

    expect(prismaMock.lakeDataset.upsert).not.toHaveBeenCalled();
    expect(prismaMock.lakeDataset.update).not.toHaveBeenCalled();
  });
});

describe("attachLakeSinkOutput", () => {
  it("stamps the Lake sink's cumulative output onto matching data points", async () => {
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", componentKey: "lake" },
    ]);
    const dataPoints: MetricsDataPoint[] = [
      dataPoint("pipe-1", { eventsOut: BigInt(20), bytesOut: BigInt(200) }),
    ];

    await attachLakeSinkOutput(dataPoints, [
      {
        pipelineId: "pipe-1",
        componentMetrics: [
          { componentId: "user_sink", componentKind: "sink", sentEvents: 10, sentBytes: 120 },
          { componentId: "lake", componentKind: "sink", sentEvents: 10, sentBytes: 80 },
          { componentId: "src", componentKind: "source", sentEvents: 10, sentBytes: 0 },
        ],
      },
    ]);

    expect(dataPoints[0].lakeEventsOut).toBe(BigInt(10));
    expect(dataPoints[0].lakeBytesOut).toBe(BigInt(80));
  });

  it("ignores non-sink components even when the key matches a Lake node", async () => {
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", componentKey: "lake" },
    ]);
    const dataPoints: MetricsDataPoint[] = [dataPoint("pipe-1")];

    await attachLakeSinkOutput(dataPoints, [
      {
        pipelineId: "pipe-1",
        componentMetrics: [
          { componentId: "lake", componentKind: "transform", sentEvents: 99, sentBytes: 99 },
          { componentId: "user_sink", componentKind: "sink", sentEvents: 5, sentBytes: 50 },
        ],
      },
    ]);

    expect(dataPoints[0].lakeEventsOut).toBe(BigInt(0));
    expect(dataPoints[0].lakeBytesOut).toBe(BigInt(0));
  });

  it("leaves data points untouched when the pipeline has no Lake node", async () => {
    prismaMock.pipelineNode.findMany.mockResolvedValue([]);
    const dataPoints: MetricsDataPoint[] = [dataPoint("pipe-1")];

    await attachLakeSinkOutput(dataPoints, [
      {
        pipelineId: "pipe-1",
        componentMetrics: [
          { componentId: "lake", componentKind: "sink", sentEvents: 10, sentBytes: 80 },
        ],
      },
    ]);

    expect(dataPoints[0].lakeEventsOut).toBeUndefined();
    expect(dataPoints[0].lakeBytesOut).toBeUndefined();
  });
});
