import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { QA_IDS, resetQaSeed } from "@/server/services/qa-seed";

describe("resetQaSeed", () => {
  let prismaMock: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    mockReset(prismaMock);
  });

  it("deletes QA-scoped runtime records before dropping the seeded environment", async () => {
    await resetQaSeed(prismaMock);

    expect(prismaMock.activeTap.deleteMany).toHaveBeenCalledWith({
      where: { pipelineId: QA_IDS.pipeline },
    });
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { teamId: QA_IDS.team },
          { environmentId: QA_IDS.environment },
          { entityId: { in: [QA_IDS.team, QA_IDS.environment, QA_IDS.pipeline, QA_IDS.vectorNode] } },
        ],
      },
    });
    expect(prismaMock.sharedComponent.deleteMany).toHaveBeenCalledWith({
      where: { environmentId: QA_IDS.environment },
    });
    expect(prismaMock.filterPreset.deleteMany).toHaveBeenCalledWith({
      where: { environmentId: QA_IDS.environment },
    });
    expect(prismaMock.stagedRollout.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ environmentId: QA_IDS.environment }, { pipelineId: QA_IDS.pipeline }] },
    });

    const envDeleteOrder = prismaMock.environment.deleteMany.mock.invocationCallOrder[0];
    expect(prismaMock.activeTap.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.auditLog.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.sharedComponent.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.filterPreset.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.stagedRollout.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
  });
});
