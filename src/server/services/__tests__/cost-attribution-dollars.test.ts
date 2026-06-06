import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

import { prisma } from "@/lib/prisma";
import {
  projectSinkCostCents,
  getCostBySink,
  getPrimarySinkTypes,
  type DestinationCostModelLite,
} from "@/server/services/cost-attribution";
import { LAKE_SINK_TYPE } from "@/lib/vector/lake-sink";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const GIB = 1_073_741_824;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("projectSinkCostCents", () => {
  const models: DestinationCostModelLite[] = [
    { sinkType: "datadog_logs", pricePerGbCents: 250 },
    { sinkType: "splunk_hec", pricePerGbCents: 100 },
  ];

  it("equals bytes x pricePerGbCents / GB for a configured sink", () => {
    // 2 GiB * 250 cents/GB
    expect(projectSinkCostCents(2 * GIB, "datadog_logs", models)).toBe(500);
    // 1 GiB * 100 cents/GB
    expect(projectSinkCostCents(GIB, "splunk_hec", models)).toBe(100);
    // 0.5 GiB * 250 = 125
    expect(projectSinkCostCents(0.5 * GIB, "datadog_logs", models)).toBe(125);
  });

  it("returns null (byte-only) when the sink has no configured model", () => {
    expect(projectSinkCostCents(2 * GIB, "elasticsearch", models)).toBeNull();
  });

  it("returns null when there are no cost models at all", () => {
    expect(projectSinkCostCents(2 * GIB, "datadog_logs", [])).toBeNull();
  });
});

describe("getCostBySink", () => {
  it("attributes bytesOut to the primary sink type and projects $ only where priced", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([
      { pipelineId: "p1", _sum: { bytesOut: BigInt(2 * GIB) } },
      { pipelineId: "p2", _sum: { bytesOut: BigInt(GIB) } },
    ] as never);
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "p1", componentType: "datadog_logs", componentKey: "dd" },
      { pipelineId: "p2", componentType: "elasticsearch", componentKey: "es" },
    ] as never);
    prismaMock.destinationCostModel.findMany.mockResolvedValue([
      { sinkType: "datadog_logs", label: "Datadog", pricePerGbCents: 250 },
    ] as never);

    const rows = await getCostBySink({
      environmentId: "env-1",
      range: "1d",
      organizationId: "org-1",
    });

    const dd = rows.find((r) => r.sinkType === "datadog_logs")!;
    expect(dd.bytesOut).toBe(2 * GIB);
    expect(dd.pricePerGbCents).toBe(250);
    expect(dd.costCents).toBe(500); // 2 GiB * 250
    expect(dd.label).toBe("Datadog");

    const es = rows.find((r) => r.sinkType === "elasticsearch")!;
    expect(es.bytesOut).toBe(GIB);
    expect(es.costCents).toBeNull(); // unpriced → byte-only
    expect(es.pricePerGbCents).toBeNull();
  });

  it("sums bytesOut across pipelines sharing a sink type", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([
      { pipelineId: "p1", _sum: { bytesOut: BigInt(GIB) } },
      { pipelineId: "p2", _sum: { bytesOut: BigInt(GIB) } },
    ] as never);
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "p1", componentType: "datadog_logs", componentKey: "dd1" },
      { pipelineId: "p2", componentType: "datadog_logs", componentKey: "dd2" },
    ] as never);
    prismaMock.destinationCostModel.findMany.mockResolvedValue([
      { sinkType: "datadog_logs", label: null, pricePerGbCents: 100 },
    ] as never);

    const rows = await getCostBySink({
      environmentId: "env-1",
      range: "1d",
      organizationId: "org-1",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].bytesOut).toBe(2 * GIB);
    expect(rows[0].costCents).toBe(200); // 2 GiB * 100
  });

  it("returns [] when there are no metrics", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.pipelineMetric.groupBy.mockResolvedValue([] as never);
    const rows = await getCostBySink({
      environmentId: "env-1",
      range: "1d",
      organizationId: "org-1",
    });
    expect(rows).toEqual([]);
  });
});

describe("getPrimarySinkTypes", () => {
  it("excludes the managed Lake sink from the primary-sink query", async () => {
    prismaMock.pipelineNode.findMany.mockResolvedValue([
      { pipelineId: "p1", componentType: "s3", componentKey: "user_sink" },
    ] as never);

    const map = await getPrimarySinkTypes(["p1"]);

    // The Lake sink must be filtered out at the query level so it can never be
    // attributed as the billable primary sink for cost.
    expect(prismaMock.pipelineNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "SINK",
          componentType: { not: LAKE_SINK_TYPE },
        }),
      }),
    );
    expect(map.get("p1")).toBe("s3");
  });
});
