import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { queryErrorContext } from "../error-context";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

describe("queryErrorContext", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns null when no ERROR logs exist", async () => {
    prismaMock.pipelineLog.findMany.mockResolvedValue([]);
    const result = await queryErrorContext("pipeline-1");
    expect(result).toBeNull();
  });

  it("returns up to 5 error log lines with timestamps", async () => {
    const mockLogs = Array.from({ length: 7 }, (_, i) => ({
      id: `log-${i}`,
      pipelineId: "pipeline-1",
      nodeId: "node-1",
      timestamp: new Date(`2026-04-01T12:00:0${i}Z`),
      level: "ERROR" as const,
      message: `Error message ${i}`,
    }));
    prismaMock.pipelineLog.findMany.mockResolvedValue(mockLogs);

    const result = await queryErrorContext("pipeline-1");
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(5);
    expect(result!.truncated).toBe(true);
    expect(result!.lines[0]).toEqual({
      timestamp: expect.any(String),
      message: "Error message 0",
    });
  });

  it("truncates messages longer than 300 chars", async () => {
    const longMessage = "x".repeat(500);
    prismaMock.pipelineLog.findMany.mockResolvedValue([{
      id: "log-1",
      pipelineId: "pipeline-1",
      nodeId: "node-1",
      timestamp: new Date(),
      level: "ERROR" as const,
      message: longMessage,
    }]);

    const result = await queryErrorContext("pipeline-1");
    expect(result).not.toBeNull();
    expect(result!.lines[0].message.length).toBeLessThanOrEqual(303);
    expect(result!.truncated).toBe(true);
  });

  it("uses custom window minutes", async () => {
    prismaMock.pipelineLog.findMany.mockResolvedValue([]);
    await queryErrorContext("pipeline-1", 30);
    expect(prismaMock.pipelineLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pipelineId: "pipeline-1",
          level: "ERROR",
        }),
        take: 6,
      }),
    );
  });

  it("returns truncated=false when all lines fit and no truncation", async () => {
    prismaMock.pipelineLog.findMany.mockResolvedValue([{
      id: "log-1",
      pipelineId: "pipeline-1",
      nodeId: "node-1",
      timestamp: new Date(),
      level: "ERROR" as const,
      message: "Short error",
    }]);

    const result = await queryErrorContext("pipeline-1");
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(1);
    expect(result!.truncated).toBe(false);
  });
});
