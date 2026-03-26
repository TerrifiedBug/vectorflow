import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// ─── Import the mocked modules + SUT ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  addDependency,
  removeDependency,
  getUpstreams,
  getDownstreams,
  getUndeployedUpstreams,
  getDeployedDownstreams,
} from "@/server/services/pipeline-dependency";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makePipeline(overrides: { id: string; environmentId?: string; name?: string }) {
  return {
    id: overrides.id,
    environmentId: overrides.environmentId ?? "env-1",
    name: overrides.name ?? `Pipeline ${overrides.id}`,
  };
}

function makeDep(overrides: {
  id?: string;
  upstreamId: string;
  downstreamId: string;
  description?: string | null;
}) {
  return {
    id: overrides.id ?? `dep-${overrides.upstreamId}-${overrides.downstreamId}`,
    upstreamId: overrides.upstreamId,
    downstreamId: overrides.downstreamId,
    description: overrides.description ?? null,
    createdAt: new Date(),
  };
}

// ─── Reset mocks ────────────────────────────────────────────────────────────

beforeEach(() => {
  mockReset(prismaMock);
});

// ─── Tests: addDependency ───────────────────────────────────────────────────

describe("addDependency", () => {
  it("rejects self-reference", async () => {
    await expect(addDependency("p1", "p1")).rejects.toThrow(TRPCError);
    await expect(addDependency("p1", "p1")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A pipeline cannot depend on itself",
    });
  });

  it("rejects cross-environment dependency", async () => {
    prismaMock.pipeline.findUnique
      .mockResolvedValueOnce(makePipeline({ id: "p1", environmentId: "env-1" }) as never)
      .mockResolvedValueOnce(makePipeline({ id: "p2", environmentId: "env-2" }) as never);

    await expect(addDependency("p1", "p2")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Dependencies must be within the same environment",
    });
  });

  it("rejects duplicate dependency", async () => {
    prismaMock.pipeline.findUnique
      .mockResolvedValueOnce(makePipeline({ id: "p1" }) as never)
      .mockResolvedValueOnce(makePipeline({ id: "p2" }) as never);

    prismaMock.pipelineDependency.findUnique.mockResolvedValueOnce(
      makeDep({ upstreamId: "p1", downstreamId: "p2" }) as never,
    );

    await expect(addDependency("p1", "p2")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This dependency already exists",
    });
  });

  it("detects direct cycle (A→B, B tries to depend on A)", async () => {
    // Setup: p2 depends on p1 already. Now trying to add p1 depends on p2.
    // addDependency("p2", "p1") means upstreamId=p2, downstreamId=p1.
    // Existing: upstreamId=p1, downstreamId=p2 (p2 depends on p1).
    // Cycle check: wouldCreateCycle(downstreamId=p1, upstreamId=p2)
    //   = starting from p1, can we reach p2 via downstream edges?
    //   p1 is upstream of p2 (existing edge), so p1's downstreamDeps query returns p2.
    //   p2 === target(p2) → cycle!

    prismaMock.pipeline.findUnique
      .mockResolvedValueOnce(makePipeline({ id: "p2" }) as never)
      .mockResolvedValueOnce(makePipeline({ id: "p1" }) as never);

    prismaMock.pipelineDependency.findUnique.mockResolvedValueOnce(null as never);

    // Cycle detection DFS: starting from p1 (downstreamId), follow upstreamId edges
    prismaMock.pipelineDependency.findMany
      .mockResolvedValueOnce([{ downstreamId: "p2" }] as never) // p1 → p2
      .mockResolvedValueOnce([] as never); // p2 has no further downstream edges (but we already found target)

    await expect(addDependency("p2", "p1")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Cannot add: would create a circular dependency",
    });
  });

  it("detects transitive cycle (A→B→C, C tries to depend on A)", async () => {
    // Existing: A is upstream of B, B is upstream of C.
    // Trying: addDependency("C", "A") — upstream=C, downstream=A
    // Cycle check: wouldCreateCycle(downstreamId=A, upstreamId=C)
    //   Start at A, follow downstream edges:
    //   A → B (A is upstream of B), B → C (B is upstream of C), C === target → cycle!

    prismaMock.pipeline.findUnique
      .mockResolvedValueOnce(makePipeline({ id: "C" }) as never)
      .mockResolvedValueOnce(makePipeline({ id: "A" }) as never);

    prismaMock.pipelineDependency.findUnique.mockResolvedValueOnce(null as never);

    // DFS from A:
    prismaMock.pipelineDependency.findMany
      .mockResolvedValueOnce([{ downstreamId: "B" }] as never)  // A → B
      .mockResolvedValueOnce([{ downstreamId: "C" }] as never)  // B → C
      // C === target, so DFS returns true before querying further
      ;

    await expect(addDependency("C", "A")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Cannot add: would create a circular dependency",
    });
  });

  it("allows diamond dependency (A→B, A→C, B→D, C→D — no cycle)", async () => {
    // Trying: addDependency("C", "D") — upstream=C, downstream=D
    // Existing: A→B, A→C, B→D
    // Cycle check: wouldCreateCycle(downstreamId=D, upstreamId=C)
    //   Start at D, follow downstream edges: D has no downstream deps → no cycle.

    prismaMock.pipeline.findUnique
      .mockResolvedValueOnce(makePipeline({ id: "C" }) as never)
      .mockResolvedValueOnce(makePipeline({ id: "D" }) as never);

    prismaMock.pipelineDependency.findUnique.mockResolvedValueOnce(null as never);

    // DFS from D:
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never); // D has no downstream edges

    const createdDep = makeDep({ upstreamId: "C", downstreamId: "D" });
    prismaMock.pipelineDependency.create.mockResolvedValueOnce({
      ...createdDep,
      upstream: { id: "C", name: "Pipeline C", isDraft: false, deployedAt: null },
    } as never);

    const result = await addDependency("C", "D");
    expect(result.upstreamId).toBe("C");
    expect(result.downstreamId).toBe("D");
  });

  it("successfully adds a dependency", async () => {
    prismaMock.pipeline.findUnique
      .mockResolvedValueOnce(makePipeline({ id: "p1" }) as never)
      .mockResolvedValueOnce(makePipeline({ id: "p2" }) as never);

    prismaMock.pipelineDependency.findUnique.mockResolvedValueOnce(null as never);

    // DFS from p2 (downstreamId) — no edges found
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never);

    const createdDep = makeDep({ upstreamId: "p1", downstreamId: "p2" });
    prismaMock.pipelineDependency.create.mockResolvedValueOnce({
      ...createdDep,
      upstream: { id: "p1", name: "Pipeline p1", isDraft: false, deployedAt: null },
    } as never);

    const result = await addDependency("p1", "p2");
    expect(result.upstreamId).toBe("p1");
    expect(result.downstreamId).toBe("p2");
    expect(prismaMock.pipelineDependency.create).toHaveBeenCalledWith({
      data: { upstreamId: "p1", downstreamId: "p2", description: undefined },
      include: {
        upstream: { select: { id: true, name: true, isDraft: true, deployedAt: true } },
      },
    });
  });

  it("throws NOT_FOUND when pipeline does not exist", async () => {
    prismaMock.pipeline.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(makePipeline({ id: "p2" }) as never);

    await expect(addDependency("p1", "p2")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "One or both pipelines not found",
    });
  });
});

// ─── Tests: removeDependency ────────────────────────────────────────────────

describe("removeDependency", () => {
  it("removes an existing dependency", async () => {
    const dep = makeDep({ id: "dep-1", upstreamId: "p1", downstreamId: "p2" });
    prismaMock.pipelineDependency.findUnique.mockResolvedValueOnce(dep as never);
    prismaMock.pipelineDependency.delete.mockResolvedValueOnce(dep as never);

    const result = await removeDependency("dep-1");
    expect(result.id).toBe("dep-1");
    expect(prismaMock.pipelineDependency.delete).toHaveBeenCalledWith({
      where: { id: "dep-1" },
    });
  });

  it("throws NOT_FOUND for nonexistent dependency", async () => {
    prismaMock.pipelineDependency.findUnique.mockResolvedValueOnce(null as never);

    await expect(removeDependency("nonexistent")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Dependency not found",
    });
  });
});

// ─── Tests: getUpstreams / getDownstreams ────────────────────────────────────

describe("getUpstreams", () => {
  it("returns upstream dependencies for a pipeline", async () => {
    const deps = [
      {
        ...makeDep({ upstreamId: "p1", downstreamId: "p3" }),
        upstream: { id: "p1", name: "Pipeline p1", isDraft: false, deployedAt: null },
      },
      {
        ...makeDep({ upstreamId: "p2", downstreamId: "p3" }),
        upstream: { id: "p2", name: "Pipeline p2", isDraft: true, deployedAt: null },
      },
    ];
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce(deps as never);

    const result = await getUpstreams("p3");
    expect(result).toHaveLength(2);
    expect(result[0].upstream.id).toBe("p1");
    expect(result[1].upstream.id).toBe("p2");
  });

  it("returns empty list when no upstream dependencies exist", async () => {
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never);

    const result = await getUpstreams("p1");
    expect(result).toHaveLength(0);
  });
});

describe("getDownstreams", () => {
  it("returns downstream dependencies for a pipeline", async () => {
    const deps = [
      {
        ...makeDep({ upstreamId: "p1", downstreamId: "p2" }),
        downstream: { id: "p2", name: "Pipeline p2", isDraft: false, deployedAt: null },
      },
    ];
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce(deps as never);

    const result = await getDownstreams("p1");
    expect(result).toHaveLength(1);
    expect(result[0].downstream.id).toBe("p2");
  });

  it("returns empty list when no downstream dependencies exist", async () => {
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never);

    const result = await getDownstreams("p1");
    expect(result).toHaveLength(0);
  });
});

// ─── Tests: getUndeployedUpstreams ──────────────────────────────────────────

describe("getUndeployedUpstreams", () => {
  it("returns only upstreams where isDraft=true", async () => {
    const deps = [
      {
        ...makeDep({ upstreamId: "p1", downstreamId: "p3" }),
        upstream: { id: "p1", name: "Pipeline p1" },
      },
    ];
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce(deps as never);

    const result = await getUndeployedUpstreams("p3");
    expect(result).toHaveLength(1);
    expect(result[0].upstream.id).toBe("p1");
    expect(prismaMock.pipelineDependency.findMany).toHaveBeenCalledWith({
      where: {
        downstreamId: "p3",
        upstream: { isDraft: true },
      },
      include: {
        upstream: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns empty array when all upstreams are deployed", async () => {
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never);

    const result = await getUndeployedUpstreams("p3");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when pipeline has no upstreams", async () => {
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never);

    const result = await getUndeployedUpstreams("p-no-deps");
    expect(result).toHaveLength(0);
  });
});

// ─── Tests: getDeployedDownstreams ──────────────────────────────────────────

describe("getDeployedDownstreams", () => {
  it("returns only downstreams where isDraft=false", async () => {
    const deps = [
      {
        ...makeDep({ upstreamId: "p1", downstreamId: "p2" }),
        downstream: { id: "p2", name: "Pipeline p2" },
      },
      {
        ...makeDep({ upstreamId: "p1", downstreamId: "p4" }),
        downstream: { id: "p4", name: "Pipeline p4" },
      },
    ];
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce(deps as never);

    const result = await getDeployedDownstreams("p1");
    expect(result).toHaveLength(2);
    expect(result[0].downstream.id).toBe("p2");
    expect(result[1].downstream.id).toBe("p4");
    expect(prismaMock.pipelineDependency.findMany).toHaveBeenCalledWith({
      where: {
        upstreamId: "p1",
        downstream: { isDraft: false },
      },
      include: {
        downstream: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns empty array when all downstreams are drafts", async () => {
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never);

    const result = await getDeployedDownstreams("p1");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when pipeline has no downstreams", async () => {
    prismaMock.pipelineDependency.findMany.mockResolvedValueOnce([] as never);

    const result = await getDeployedDownstreams("p-no-deps");
    expect(result).toHaveLength(0);
  });
});
