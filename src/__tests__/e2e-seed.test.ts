import { describe, expect, it, vi } from "vitest";

vi.mock("bcryptjs", () => ({
  hash: vi.fn(async () => "hashed-password"),
}));

vi.mock("../../src/generated/prisma", () => ({}));

import { seed } from "../../e2e/helpers/seed";

function createMockPrisma() {
  let pipelineNodeCount = 0;
  let alertRuleCount = 0;
  let alertEventCount = 0;
  let vectorNodeCount = 0;

  return {
    user: {
      create: vi.fn(async () => ({ id: "user-1" })),
    },
    team: {
      create: vi.fn(async () => ({ id: "team-1" })),
      update: vi.fn(async () => ({ id: "team-1" })),
    },
    teamMember: {
      create: vi.fn(async () => ({ id: "team-member-1" })),
    },
    environment: {
      create: vi.fn(async () => ({ id: "env-1" })),
    },
    pipeline: {
      create: vi.fn(async () => ({ id: "pipeline-1" })),
    },
    pipelineNode: {
      create: vi.fn(async () => {
        pipelineNodeCount += 1;
        return {
          id: `pipeline-node-${pipelineNodeCount}`,
          config: {},
        };
      }),
    },
    pipelineEdge: {
      createMany: vi.fn(async () => ({ count: 2 })),
    },
    pipelineVersion: {
      create: vi.fn(async () => ({ id: "pipeline-version-1" })),
    },
    vectorNode: {
      create: vi.fn(async () => {
        vectorNodeCount += 1;
        return { id: `node-${vectorNodeCount}` };
      }),
    },
    nodePipelineStatus: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    nodeStatusEvent: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    nodeMetric: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    pipelineMetric: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    alertRule: {
      create: vi.fn(async () => {
        alertRuleCount += 1;
        return { id: `alert-rule-${alertRuleCount}` };
      }),
    },
    notificationChannel: {
      create: vi.fn(async () => ({ id: "channel-1" })),
    },
    alertEvent: {
      create: vi.fn(async () => {
        alertEventCount += 1;
        return { id: `alert-event-${alertEventCount}` };
      }),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}

describe("e2e seed", () => {
  it("creates realistic observability history for dashboard and alert suites", async () => {
    const prisma = createMockPrisma();

    await seed(prisma as never);

    expect(prisma.environment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          costPerGbCents: expect.any(Number),
          costBudgetCents: expect.any(Number),
        }),
      }),
    );

    expect(prisma.nodeMetric.createMany).toHaveBeenCalled();
    const nodeMetrics = firstCallArg(prisma.nodeMetric.createMany).data as { timestamp: Date }[];
    expect(nodeMetrics.length).toBeGreaterThanOrEqual(24);
    expect(hoursCoveredBy(nodeMetrics)).toBeGreaterThanOrEqual(24);
    expect(maxGapHours(nodeMetrics)).toBeGreaterThanOrEqual(4);

    expect(prisma.pipelineMetric.createMany).toHaveBeenCalled();
    const pipelineMetrics = firstCallArg(prisma.pipelineMetric.createMany).data as {
      timestamp: Date;
      componentId?: string | null;
    }[];
    expect(pipelineMetrics.length).toBeGreaterThanOrEqual(24);
    expect(hoursCoveredBy(pipelineMetrics)).toBeGreaterThanOrEqual(24);
    expect(maxGapHours(pipelineMetrics)).toBeGreaterThanOrEqual(4);
    expect(pipelineMetrics.some((row: { componentId?: string | null }) => row.componentId === null)).toBe(true);

    expect(prisma.nodePipelineStatus.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ configChecksum: "pipeline-v1-current" }),
          expect.objectContaining({ configChecksum: "pipeline-v0-drifted" }),
        ]),
      }),
    );

    expect(prisma.alertRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metric: "cost_threshold_exceeded",
        }),
      }),
    );

    const alertEvents = prisma.alertEvent.create.mock.calls.map(
      (call) => firstArg(call).data as { status: string },
    );
    expect(alertEvents.filter((event) => event.status === "firing").length).toBeGreaterThanOrEqual(3);
    expect(alertEvents.filter((event) => event.status === "resolved").length).toBeGreaterThanOrEqual(2);
  });
});

function hoursCoveredBy(rows: { timestamp: Date }[]) {
  const times = rows.map((row) => row.timestamp.getTime()).sort((a, b) => a - b);
  return (times.at(-1)! - times[0]) / 3_600_000;
}

function maxGapHours(rows: { timestamp: Date }[]) {
  const times = rows.map((row) => row.timestamp.getTime()).sort((a, b) => a - b);
  let maxGapMs = 0;
  for (let i = 1; i < times.length; i += 1) {
    maxGapMs = Math.max(maxGapMs, times[i] - times[i - 1]);
  }
  return maxGapMs / 3_600_000;
}

function firstCallArg(mock: ReturnType<typeof vi.fn>) {
  const call = mock.mock.calls[0];
  return firstArg(call);
}

function firstArg(call: unknown[]) {
  const arg = call[0];
  if (!arg || typeof arg !== "object") {
    throw new Error("Expected mock to be called with an object argument");
  }
  return arg as { data: unknown };
}
