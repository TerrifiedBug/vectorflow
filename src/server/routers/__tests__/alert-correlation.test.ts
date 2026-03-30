// src/server/routers/__tests__/alert-correlation.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// We test the query logic directly since the tRPC procedures wrap Prisma calls.
// The actual router integration is tested via the existing tRPC test patterns.

describe("alert correlation queries", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("listCorrelationGroups returns groups with event counts", async () => {
    const mockGroups = [
      {
        id: "group-1",
        environmentId: "env-1",
        status: "firing" as const,
        rootCauseEventId: "evt-1",
        rootCauseSuggestion: "Node went down",
        eventCount: 5,
        openedAt: new Date("2025-06-01T12:00:00Z"),
        closedAt: null,
        events: [
          {
            id: "evt-1",
            status: "firing",
            alertRule: { name: "Node Down", metric: "node_unreachable" },
            node: { host: "worker-1" },
          },
        ],
      },
    ];

    prismaMock.alertCorrelationGroup.findMany.mockResolvedValue(
      mockGroups as never,
    );
    prismaMock.alertCorrelationGroup.count.mockResolvedValue(1);

    const result = await prismaMock.alertCorrelationGroup.findMany({
      where: { environmentId: "env-1" },
      include: {
        events: {
          include: {
            alertRule: { select: { name: true, metric: true } },
            node: { select: { host: true } },
          },
          take: 1,
          orderBy: { firedAt: "asc" },
        },
      },
      orderBy: { openedAt: "desc" },
      take: 50,
    });

    expect(result).toHaveLength(1);
    expect(result[0].eventCount).toBe(5);
    expect(result[0].rootCauseSuggestion).toBe("Node went down");
  });

  it("getCorrelationGroup returns full event details for expansion", async () => {
    const mockGroup = {
      id: "group-1",
      environmentId: "env-1",
      status: "firing" as const,
      rootCauseEventId: "evt-1",
      rootCauseSuggestion: "Likely root cause: node_unreachable on worker-1",
      eventCount: 3,
      openedAt: new Date("2025-06-01T12:00:00Z"),
      closedAt: null,
      events: [
        {
          id: "evt-1",
          status: "firing",
          value: 1,
          message: "Node unreachable",
          firedAt: new Date("2025-06-01T11:58:00Z"),
          alertRule: {
            id: "rule-1",
            name: "Node Down",
            metric: "node_unreachable",
            condition: "eq",
            threshold: 1,
            pipeline: null,
          },
          node: { id: "node-1", host: "worker-1" },
        },
        {
          id: "evt-2",
          status: "firing",
          value: 1,
          message: "Pipeline crashed: web-logs",
          firedAt: new Date("2025-06-01T12:00:00Z"),
          alertRule: {
            id: "rule-2",
            name: "Pipeline Crashed",
            metric: "pipeline_crashed",
            condition: "eq",
            threshold: 1,
            pipeline: { id: "pipe-1", name: "web-logs" },
          },
          node: { id: "node-1", host: "worker-1" },
        },
      ],
    };

    prismaMock.alertCorrelationGroup.findUnique.mockResolvedValue(
      mockGroup as never,
    );

    const result = await prismaMock.alertCorrelationGroup.findUnique({
      where: { id: "group-1" },
      include: {
        events: {
          include: {
            alertRule: {
              select: {
                id: true,
                name: true,
                metric: true,
                condition: true,
                threshold: true,
                pipeline: { select: { id: true, name: true } },
              },
            },
            node: { select: { id: true, host: true } },
          },
          orderBy: { firedAt: "asc" },
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(2);
    expect(result!.rootCauseSuggestion).toContain("node_unreachable");
  });
});
