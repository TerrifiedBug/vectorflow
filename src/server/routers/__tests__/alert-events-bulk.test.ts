import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

describe("bulkAcknowledge", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("updates only firing events to acknowledged status", async () => {
    prismaMock.alertEvent.updateMany.mockResolvedValue({ count: 3 });

    const result = await prismaMock.alertEvent.updateMany({
      where: {
        id: { in: ["evt-1", "evt-2", "evt-3", "evt-4"] },
        status: "firing",
      },
      data: {
        status: "acknowledged",
        acknowledgedAt: expect.any(Date),
        acknowledgedBy: "user@example.com",
      },
    });

    expect(result.count).toBe(3);
    expect(prismaMock.alertEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "firing",
        }),
      }),
    );
  });

  it("returns zero count when no events match", async () => {
    prismaMock.alertEvent.updateMany.mockResolvedValue({ count: 0 });

    const result = await prismaMock.alertEvent.updateMany({
      where: {
        id: { in: ["evt-nonexistent"] },
        status: "firing",
      },
      data: {
        status: "acknowledged",
        acknowledgedAt: new Date(),
        acknowledgedBy: "user@example.com",
      },
    });

    expect(result.count).toBe(0);
  });
});

describe("bulkDismiss", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("updates firing and acknowledged events to dismissed", async () => {
    prismaMock.alertEvent.updateMany.mockResolvedValue({ count: 5 });

    const result = await prismaMock.alertEvent.updateMany({
      where: {
        id: { in: ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"] },
        status: { in: ["firing", "acknowledged"] },
      },
      data: {
        status: "dismissed",
      },
    });

    expect(result.count).toBe(5);
    expect(prismaMock.alertEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["firing", "acknowledged"] },
        }),
      }),
    );
  });

  it("does not update already dismissed or resolved events", async () => {
    prismaMock.alertEvent.updateMany.mockResolvedValue({ count: 0 });

    const result = await prismaMock.alertEvent.updateMany({
      where: {
        id: { in: ["evt-already-dismissed"] },
        status: { in: ["firing", "acknowledged"] },
      },
      data: {
        status: "dismissed",
      },
    });

    expect(result.count).toBe(0);
  });
});
