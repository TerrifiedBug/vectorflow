import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { QA_IDS, resetQaSeed } from "@/server/services/qa-seed";

describe("resetQaSeed", () => {
  let prismaMock: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    mockReset(prismaMock);
    prismaMock.pipeline.findMany.mockResolvedValue(QA_IDS.pipelines.map((id) => ({ id })) as never);
    prismaMock.vectorNode.findMany.mockResolvedValue(QA_IDS.vectorNodes.map((id) => ({ id })) as never);
    prismaMock.release.findMany.mockImplementation(((args: {
      where?: { strategy?: string };
    }) =>
      Promise.resolve(
        args?.where?.strategy === "PROMOTION"
          ? QA_IDS.promotions.map((id) => ({ id }))
          : [],
      )) as never);
    prismaMock.alertRule.findMany.mockResolvedValue(QA_IDS.alertRules.map((id) => ({ id })) as never);
    prismaMock.notificationChannel.findMany.mockResolvedValue(QA_IDS.notificationChannels.map((id) => ({ id })) as never);
    prismaMock.alertCorrelationGroup.findMany.mockResolvedValue(QA_IDS.correlationGroups.map((id) => ({ id })) as never);
    prismaMock.serviceAccount.findMany.mockResolvedValue([] as never);
    prismaMock.template.findMany.mockResolvedValue(QA_IDS.templates.map((id) => ({ id })) as never);
    prismaMock.secret.findMany.mockResolvedValue([] as never);
    prismaMock.anomalyEvent.findMany.mockResolvedValue([] as never);
    prismaMock.alertEvent.findMany.mockResolvedValue([] as never);
    prismaMock.gitSyncJob.findMany.mockResolvedValue([] as never);
    prismaMock.costRecommendation.findMany.mockResolvedValue([] as never);
    prismaMock.auditLog.findMany.mockResolvedValue([] as never);
  });
  it("deletes QA-scoped runtime records before dropping seeded environments", async () => {
    await resetQaSeed(prismaMock);

    expect(prismaMock.activeTap.deleteMany).toHaveBeenCalledWith({
      where: { pipelineId: { in: QA_IDS.pipelines } },
    });
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { id: { in: [] } },
          { environmentId: { in: QA_IDS.environments } },
          {
            entityId: {
              in: [
                ...QA_IDS.environments,
                ...QA_IDS.pipelines,
                ...QA_IDS.vectorNodes,
                ...QA_IDS.alertRules,
                ...QA_IDS.promotions,
                QA_IDS.team,
              ],
            },
          },
        ],
      },
    });
    expect(prismaMock.sharedComponent.deleteMany).toHaveBeenCalledWith({
      where: { environmentId: { in: QA_IDS.environments } },
    });
    expect(prismaMock.filterPreset.deleteMany).toHaveBeenCalledWith({
      where: { environmentId: { in: QA_IDS.environments } },
    });
    expect(prismaMock.release.deleteMany).toHaveBeenCalledWith({
      where: {
        strategy: "CANARY",
        OR: [
          { environmentId: { in: QA_IDS.environments } },
          { pipelineId: { in: QA_IDS.pipelines } },
        ],
      },
    });

    const envDeleteOrder = prismaMock.environment.deleteMany.mock.invocationCallOrder[0];
    expect(prismaMock.activeTap.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.auditLog.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.sharedComponent.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.filterPreset.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
    expect(prismaMock.release.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(envDeleteOrder);
  });
});
