import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// Mock the A1 ClickHouse wrapper so no real connection is attempted and we can
// assert the exact SQL + bound params the query engine builds.
const { isLakeEnabledMock, lakeQueryMock } = vi.hoisted(() => ({
  isLakeEnabledMock: vi.fn<() => boolean>(() => true),
  lakeQueryMock: vi.fn<(sql: string, params?: Record<string, unknown>) => Promise<unknown[]>>(),
}));

vi.mock("@/server/services/lake/clickhouse", () => ({
  isLakeEnabled: isLakeEnabledMock,
  lakeQuery: lakeQueryMock,
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

import { prisma } from "@/lib/prisma";
import {
  searchEvents,
  rawSearchEvents,
  getSchema,
  fieldStats,
  listDatasets,
  LakeRawWhereError,
  LAKE_MAX_LIMIT,
  LAKE_MAX_RANGE_MS,
  summarizeEvents,
  LakeSummarizeError,
  LAKE_SUMMARIZE_MAX_SERIES,
  listTraces,
  getTrace,
} from "../lake-query";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const FROM = new Date("2026-06-01T00:00:00.000Z");
const TO = new Date("2026-06-02T00:00:00.000Z");

beforeEach(() => {
  mockReset(prismaMock);
  isLakeEnabledMock.mockReturnValue(true);
  lakeQueryMock.mockReset();
  lakeQueryMock.mockResolvedValue([]);
});

describe("searchEvents — cross-tenant isolation", () => {
  it("binds organizationId as a parameter and never interpolates it into SQL", async () => {
    await searchEvents({ orgId: "org-A", pipelineId: "pipe-1", from: FROM, to: TO });

    expect(lakeQueryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(sql).toContain("pipelineId = {pipelineId:String}");
    expect(sql).not.toContain("org-A");
    expect(params).toMatchObject({ orgId: "org-A", pipelineId: "pipe-1" });
  });

  it("differs only in the bound org param across tenants — SQL text is identical", async () => {
    await searchEvents({ orgId: "org-A", pipelineId: "p", from: FROM, to: TO });
    await searchEvents({ orgId: "org-B", pipelineId: "p", from: FROM, to: TO });

    const [sqlA, paramsA] = lakeQueryMock.mock.calls[0];
    const [sqlB, paramsB] = lakeQueryMock.mock.calls[1];
    expect(sqlA).toBe(sqlB); // org identity lives ONLY in the param, never the text
    expect(paramsA?.orgId).toBe("org-A");
    expect(paramsB?.orgId).toBe("org-B");
    expect(sqlA).not.toContain("org-A");
    expect(sqlB).not.toContain("org-B");
  });

  it("binds eventType and free-text query — an injection term never reaches the SQL", async () => {
    await searchEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      eventType: "trace",
      query: "x' OR 1=1 --",
    });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("eventType = {eventType:String}");
    expect(sql).toContain("positionCaseInsensitive(message, {query:String})");
    expect(params?.eventType).toBe("trace");
    expect(params?.query).toBe("x' OR 1=1 --");
    expect(sql).not.toContain("1=1");
  });
});

describe("searchEvents — guardrails", () => {
  it("clamps an over-large limit to LAKE_MAX_LIMIT and sets statement/result/scan caps", async () => {
    await searchEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO, limit: 9_999_999 });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(params?.limit).toBe(LAKE_MAX_LIMIT);
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(sql).toContain("max_execution_time = 30");
    expect(sql).toContain(`max_result_rows = ${LAKE_MAX_LIMIT}`);
    expect(sql).toContain("result_overflow_mode = 'break'");
    expect(sql).toContain("max_rows_to_read");
  });

  it("falls back to the default limit when none / a bad value is given", async () => {
    await searchEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO });
    expect(lakeQueryMock.mock.calls[0][1]?.limit).toBe(100);

    await searchEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO, limit: -5 });
    expect(lakeQueryMock.mock.calls[1][1]?.limit).toBe(100);
  });

  it("clamps an over-wide time window to LAKE_MAX_RANGE_MS", async () => {
    const from = new Date("2020-01-01T00:00:00.000Z"); // years before `to`
    await searchEvents({ orgId: "o", pipelineId: "p", from, to: TO });

    const params = lakeQueryMock.mock.calls[0][1]!;
    const clampedFrom = params.from as Date;
    expect(TO.getTime() - clampedFrom.getTime()).toBeLessThanOrEqual(LAKE_MAX_RANGE_MS);
    expect(clampedFrom.getTime()).toBe(TO.getTime() - LAKE_MAX_RANGE_MS);
  });

  it("returns [] and never queries when the lake is disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(
      searchEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO }),
    ).resolves.toEqual([]);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });
});

describe("rawSearchEvents — ADMIN raw filter", () => {
  it("always ANDs the bound org predicate regardless of the raw filter", async () => {
    await rawSearchEvents({
      orgId: "org-A",
      pipelineId: "p",
      from: FROM,
      to: TO,
      where: "severity = 'error'",
    });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(sql).toContain("AND (severity = 'error')");
    expect(sql).not.toContain("org-A");
    expect(params?.orgId).toBe("org-A");
  });

  it("rejects subqueries, statement separators and comments before querying", async () => {
    const malicious = [
      "1=1; DROP TABLE lake_events",
      "organizationId IN (SELECT organizationId FROM lake_events)",
      "x = 1 -- comment",
      "/* sneaky */ 1=1",
      "   ",
    ];
    for (const where of malicious) {
      await expect(
        rawSearchEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO, where }),
      ).rejects.toBeInstanceOf(LakeRawWhereError);
    }
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });

  it("returns [] when disabled (without sanitising)", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(
      rawSearchEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO, where: "bad;" }),
    ).resolves.toEqual([]);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });
});

describe("getSchema", () => {
  it("org-scopes attr-key discovery and merges static + attr fields", async () => {
    lakeQueryMock.mockResolvedValue([{ field: "service" }, { field: "region" }, { field: "" }]);

    const schema = await getSchema({ orgId: "org-A", pipelineId: "p" });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(sql).not.toContain("org-A");
    expect(params?.orgId).toBe("org-A");
    expect(schema).toContainEqual({
      name: "message",
      type: "String",
      kind: "column",
    });
    expect(schema).toContainEqual({ name: "attrs.service", type: "String", kind: "attr" });
    // Empty attr keys are dropped.
    expect(schema.some((f) => f.name === "attrs.")).toBe(false);
  });

  it("returns [] when disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(getSchema({ orgId: "o", pipelineId: "p" })).resolves.toEqual([]);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });
});

describe("fieldStats", () => {
  it("uses a safe identifier for allowlisted columns and coerces UInt64 counts", async () => {
    lakeQueryMock.mockResolvedValue([{ value: "error", count: "42" }]);

    const out = await fieldStats({ orgId: "org-A", pipelineId: "p", field: "severity", from: FROM, to: TO });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("toString(severity) AS value");
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(sql).not.toContain("org-A");
    expect(params?.field).toBeUndefined();
    expect(out).toEqual([{ value: "error", count: 42 }]);
  });

  it("binds a non-allowlisted field name as an attr key (no identifier injection)", async () => {
    await fieldStats({
      orgId: "o",
      pipelineId: "p",
      field: "evil) FROM other --",
      from: FROM,
      to: TO,
    });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("attrs[{field:String}] AS value");
    expect(sql).not.toContain("evil)");
    expect(params?.field).toBe("evil) FROM other --");
  });

  it("strips the attrs. prefix when binding an attr key", async () => {
    await fieldStats({ orgId: "o", pipelineId: "p", field: "attrs.service", from: FROM, to: TO });
    expect(lakeQueryMock.mock.calls[0][1]?.field).toBe("service");
  });

  it("returns [] when disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(
      fieldStats({ orgId: "o", pipelineId: "p", field: "host", from: FROM, to: TO }),
    ).resolves.toEqual([]);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });
});

describe("listDatasets", () => {
  it("filters the catalog by organizationId only (org-scoped)", async () => {
    prismaMock.lakeDataset.findMany.mockResolvedValue([] as never);

    await listDatasets({ orgId: "org-A" });

    expect(prismaMock.lakeDataset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-A" } }),
    );
  });

  it("returns [] and skips the catalog read when disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(listDatasets({ orgId: "o" })).resolves.toEqual([]);
    expect(prismaMock.lakeDataset.findMany).not.toHaveBeenCalled();
  });
});

describe("summarizeEvents — count over time (ungrouped)", () => {
  it("buckets by a bound interval and binds org/pipeline/time, never interpolating them", async () => {
    await summarizeEvents({
      orgId: "org-A",
      pipelineId: "pipe-1",
      from: FROM,
      to: TO,
      metric: "count",
    });

    expect(lakeQueryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("toStartOfInterval(timestamp, toIntervalSecond({bucketSec:UInt32}))");
    expect(sql).toContain("count() AS value");
    expect(sql).toContain("'' AS series");
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(sql).not.toContain("org-A");
    // ungrouped → no top-N series subquery
    expect(sql).not.toContain(" IN (");
    expect(params).toMatchObject({ orgId: "org-A", pipelineId: "pipe-1" });
    expect(typeof params?.bucketSec).toBe("number");
  });

  it("maps ClickHouse rows to {bucket, series, value:number}", async () => {
    lakeQueryMock.mockResolvedValueOnce([
      { bucket: "2026-06-01 00:00:00", series: "", value: "42" },
      { bucket: "2026-06-01 00:01:00", series: "", value: 7 },
    ]);
    const out = await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "count",
    });
    expect(out).toEqual([
      { bucket: "2026-06-01 00:00:00", series: "", value: 42 },
      { bucket: "2026-06-01 00:01:00", series: "", value: 7 },
    ]);
  });

  it("returns [] and never queries when the lake is disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(
      summarizeEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO, metric: "count" }),
    ).resolves.toEqual([]);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });
});

describe("summarizeEvents — group-by + top-N", () => {
  it("binds a dynamic attr group field and restricts to top-N series via subquery", async () => {
    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "count",
      groupBy: "attrs.status",
      seriesLimit: 5,
    });
    const [sql, params] = lakeQueryMock.mock.calls[0];
    // dynamic attr key bound as a parameter — never interpolated
    expect(sql).toContain("attrs[{groupField:String}] AS series");
    expect(sql).toContain("AND attrs[{groupField:String}] IN (");
    expect(sql).toContain("LIMIT {seriesLimit:UInt32}");
    expect(params?.groupField).toBe("status");
    expect(params?.seriesLimit).toBe(5);
    expect(sql).not.toContain("status'"); // no raw identifier injection
  });

  it("uses a safe identifier for an allowlisted group column (no attr param)", async () => {
    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "count",
      groupBy: "host",
    });
    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("toString(host) AS series");
    expect(params).not.toHaveProperty("groupField");
  });

  it("clamps an over-large seriesLimit to LAKE_SUMMARIZE_MAX_SERIES", async () => {
    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "count",
      groupBy: "host",
      seriesLimit: 100_000,
    });
    expect(lakeQueryMock.mock.calls[0][1]?.seriesLimit).toBe(LAKE_SUMMARIZE_MAX_SERIES);
  });
});

describe("summarizeEvents — metrics", () => {
  it("requires a metric field for any non-count metric", async () => {
    await expect(
      summarizeEvents({ orgId: "o", pipelineId: "p", from: FROM, to: TO, metric: "avg" }),
    ).rejects.toBeInstanceOf(LakeSummarizeError);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });

  it("coerces a dynamic metric field to a number and binds it as a param", async () => {
    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "avg",
      metricField: "attrs.duration_ms",
    });
    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("avg(toFloat64OrNull(attrs[{metricField:String}]))");
    expect(params?.metricField).toBe("duration_ms");
    expect(sql).not.toContain("duration_ms'");
  });

  it("maps percentile + count_distinct to the right ClickHouse aggregate", async () => {
    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "p95",
      metricField: "attrs.latency",
    });
    expect(lakeQueryMock.mock.calls[0][0]).toContain(
      "quantile(0.95)(toFloat64OrNull(attrs[{metricField:String}]))",
    );

    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "count_distinct",
      metricField: "host",
    });
    expect(lakeQueryMock.mock.calls[1][0]).toContain("uniqExact(toString(host))");
  });
});

describe("summarizeEvents — bucket clamp", () => {
  it("bumps a too-fine bucket on a wide range so the point count stays bounded", async () => {
    // 1-day window with a 10s bucket would be 8640 points; engine bumps it up.
    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "count",
      bucketSeconds: 10,
    });
    const bucketSec = lakeQueryMock.mock.calls[0][1]?.bucketSec as number;
    expect(bucketSec).toBeGreaterThan(10);
    const rangeSec = (TO.getTime() - FROM.getTime()) / 1000;
    expect(rangeSec / bucketSec).toBeLessThanOrEqual(2000);
  });

  it("honours an in-range requested bucket", async () => {
    await summarizeEvents({
      orgId: "o",
      pipelineId: "p",
      from: FROM,
      to: TO,
      metric: "count",
      bucketSeconds: 3600,
    });
    expect(lakeQueryMock.mock.calls[0][1]?.bucketSec).toBe(3600);
  });
});

describe("listTraces — trace grouping", () => {
  it("groups by traceId, pins eventType=trace, and binds org/pipeline/time", async () => {
    await listTraces({ orgId: "org-A", pipelineId: "p1", from: FROM, to: TO });
    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("GROUP BY traceId");
    expect(sql).toContain("eventType = 'trace'");
    expect(sql).toContain("traceId != ''");
    expect(sql).toContain("count() AS spanCount");
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(sql).not.toContain("org-A");
    expect(params).toMatchObject({ orgId: "org-A", pipelineId: "p1" });
  });

  it("maps rows and normalizes status to ok/error", async () => {
    lakeQueryMock.mockResolvedValueOnce([
      {
        traceId: "t1",
        spanCount: "3",
        startTime: "2026-06-01 00:00:00",
        endTime: "2026-06-01 00:00:02",
        durationMs: "2000",
        status: "error",
      },
      {
        traceId: "t2",
        spanCount: 1,
        startTime: "2026-06-01 00:01:00",
        endTime: "2026-06-01 00:01:00",
        durationMs: 0,
        status: "ok",
      },
    ]);
    const out = await listTraces({ orgId: "o", pipelineId: "p", from: FROM, to: TO });
    expect(out).toEqual([
      { traceId: "t1", spanCount: 3, startTime: "2026-06-01 00:00:00", endTime: "2026-06-01 00:00:02", durationMs: 2000, status: "error" },
      { traceId: "t2", spanCount: 1, startTime: "2026-06-01 00:01:00", endTime: "2026-06-01 00:01:00", durationMs: 0, status: "ok" },
    ]);
  });
});

describe("getTrace — spans with schema-on-read attrs", () => {
  it("binds traceId, pins eventType=trace, and resolves name/parent/duration from attrs", async () => {
    lakeQueryMock.mockResolvedValueOnce([
      {
        spanId: "s1",
        message: "root",
        severity: "info",
        timestamp: "2026-06-01 00:00:00",
        attrs: { name: "GET /", duration_ms: "120" },
      },
      {
        spanId: "s2",
        message: "db query",
        severity: "info",
        timestamp: "2026-06-01 00:00:01",
        attrs: { parent_span_id: "s1", duration: "40" },
      },
    ]);
    const out = await getTrace({ orgId: "org-A", pipelineId: "p", traceId: "t1" });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("traceId = {traceId:String}");
    expect(sql).toContain("eventType = 'trace'");
    expect(sql).not.toContain("t1'"); // traceId never interpolated
    expect(params).toMatchObject({ traceId: "t1", orgId: "org-A" });

    expect(out[0]).toMatchObject({ spanId: "s1", parentSpanId: "", name: "GET /", durationMs: 120 });
    // s2: name falls back to message, parent from attrs, duration from `duration`
    expect(out[1]).toMatchObject({ spanId: "s2", parentSpanId: "s1", name: "db query", durationMs: 40 });
  });

  it("returns [] for an empty traceId without querying", async () => {
    await expect(getTrace({ orgId: "o", pipelineId: "p", traceId: "" })).resolves.toEqual([]);
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });
});
