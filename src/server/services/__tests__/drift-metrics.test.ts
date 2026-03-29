// src/server/services/__tests__/drift-metrics.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  getVersionDrift,
  getConfigDrift,
  setExpectedChecksum,
  clearExpectedChecksumCache,
} from "@/server/services/drift-metrics";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("getVersionDrift", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns null when no pipeline statuses exist", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);
    prismaMock.pipeline.findMany.mockResolvedValue([]);

    const result = await getVersionDrift("env-1");
    expect(result).toBeNull();
  });

  it("returns 0 when all nodes run the latest version", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", nodeId: "node-1", version: 5 },
      { pipelineId: "pipe-1", nodeId: "node-2", version: 5 },
    ] as never);
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-1",
        name: "Pipeline A",
        versions: [{ version: 5 }],
      },
    ] as never);

    const result = await getVersionDrift("env-1");
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0);
    expect(result!.driftedPipelines).toHaveLength(0);
  });

  it("returns count of drifted pipelines when versions mismatch", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", nodeId: "node-1", version: 4 },
      { pipelineId: "pipe-1", nodeId: "node-2", version: 5 },
      { pipelineId: "pipe-2", nodeId: "node-1", version: 3 },
      { pipelineId: "pipe-2", nodeId: "node-2", version: 3 },
    ] as never);
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-1",
        name: "Pipeline A",
        versions: [{ version: 5 }],
      },
      {
        id: "pipe-2",
        name: "Pipeline B",
        versions: [{ version: 3 }],
      },
    ] as never);

    const result = await getVersionDrift("env-1");
    expect(result).not.toBeNull();
    expect(result!.value).toBe(1); // 1 pipeline has drift
    expect(result!.driftedPipelines).toHaveLength(1);
    expect(result!.driftedPipelines[0].pipelineName).toBe("Pipeline A");
    expect(result!.driftedPipelines[0].expectedVersion).toBe(5);
    expect(result!.driftedPipelines[0].nodeVersions).toEqual({
      "node-1": 4,
      "node-2": 5,
    });
  });

  it("detects drift when all nodes are behind latest", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      { pipelineId: "pipe-1", nodeId: "node-1", version: 2 },
      { pipelineId: "pipe-1", nodeId: "node-2", version: 2 },
    ] as never);
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-1",
        name: "Pipeline A",
        versions: [{ version: 3 }],
      },
    ] as never);

    const result = await getVersionDrift("env-1");
    expect(result).not.toBeNull();
    expect(result!.value).toBe(1);
    expect(result!.driftedPipelines).toHaveLength(1);
  });
});

describe("getConfigDrift", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    clearExpectedChecksumCache();
  });

  it("returns null when no pipeline statuses exist", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([]);

    const result = await getConfigDrift("node-1", null);
    expect(result).toBeNull();
  });

  it("returns 0 when all checksums match", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      {
        pipelineId: "pipe-1",
        nodeId: "node-1",
        configChecksum: "abc123",
        pipeline: { name: "Pipeline A", id: "pipe-1" },
      },
    ] as never);

    setExpectedChecksum("pipe-1", "abc123");

    const result = await getConfigDrift("node-1", null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0);
  });

  it("returns count of mismatched pipelines", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      {
        pipelineId: "pipe-1",
        nodeId: "node-1",
        configChecksum: "stale-checksum",
        pipeline: { name: "Pipeline A", id: "pipe-1" },
      },
      {
        pipelineId: "pipe-2",
        nodeId: "node-1",
        configChecksum: "correct-checksum",
        pipeline: { name: "Pipeline B", id: "pipe-2" },
      },
    ] as never);

    setExpectedChecksum("pipe-1", "expected-checksum");
    setExpectedChecksum("pipe-2", "correct-checksum");

    const result = await getConfigDrift("node-1", null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(1);
  });

  it("ignores pipelines where agent does not report checksum (null)", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      {
        pipelineId: "pipe-1",
        nodeId: "node-1",
        configChecksum: null, // older agent, no checksum
        pipeline: { name: "Pipeline A", id: "pipe-1" },
      },
    ] as never);

    setExpectedChecksum("pipe-1", "expected-checksum");

    const result = await getConfigDrift("node-1", null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0); // null checksum is not drift
  });
});
