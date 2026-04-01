import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  matchesKeyword,
  severityAtOrAbove,
  checkKeywordMatches,
  _resetForTesting,
} from "../keyword-alert";

const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>;

describe("matchesKeyword", () => {
  it("matches case-insensitively", () => {
    expect(matchesKeyword("Connection refused by host", "connection refused")).toBe(true);
  });

  it("returns false when keyword not present", () => {
    expect(matchesKeyword("All systems operational", "error")).toBe(false);
  });

  it("matches partial substrings", () => {
    expect(matchesKeyword("NullPointerException at line 42", "NullPointer")).toBe(true);
  });
});

describe("severityAtOrAbove", () => {
  it("ERROR >= ERROR is true", () => {
    expect(severityAtOrAbove("ERROR", "ERROR")).toBe(true);
  });

  it("WARN >= ERROR is false", () => {
    expect(severityAtOrAbove("WARN", "ERROR")).toBe(false);
  });

  it("ERROR >= WARN is true", () => {
    expect(severityAtOrAbove("ERROR", "WARN")).toBe(true);
  });

  it("INFO >= TRACE is true", () => {
    expect(severityAtOrAbove("INFO", "TRACE")).toBe(true);
  });

  it("TRACE >= INFO is false", () => {
    expect(severityAtOrAbove("TRACE", "INFO")).toBe(false);
  });
});

describe("checkKeywordMatches", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    _resetForTesting();
  });

  it("does nothing when no keyword rules exist", async () => {
    // Empty rule cache — no rules loaded
    prismaMock.alertRule.findMany.mockResolvedValue([]);
    const { refreshKeywordRuleCache } = await import("../keyword-alert");
    await refreshKeywordRuleCache();

    await checkKeywordMatches("pipeline-1", [
      { message: "some error", level: "ERROR" },
    ]);

    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
  });

  it("fires alert when match count exceeds threshold", async () => {
    // Set up a rule: fire when "timeout" appears > 2 times in 5 minutes
    prismaMock.alertRule.findMany.mockResolvedValue([
      {
        id: "rule-1",
        name: "Timeout Alert",
        enabled: true,
        environmentId: "env-1",
        pipelineId: "pipeline-1",
        teamId: "team-1",
        metric: "log_keyword" as never,
        condition: "gt" as never,
        threshold: 2,
        durationSeconds: null,
        cooldownMinutes: 15,
        snoozedUntil: null,
        keyword: "timeout",
        keywordSeverityFilter: null,
        keywordWindowMinutes: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const { refreshKeywordRuleCache } = await import("../keyword-alert");
    await refreshKeywordRuleCache();

    // Mock: no existing firing event
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);
    prismaMock.alertEvent.create.mockResolvedValue({} as never);

    // Send 3 lines with "timeout" — should exceed threshold of 2
    await checkKeywordMatches("pipeline-1", [
      { message: "Connection timeout on port 8080", level: "ERROR" },
      { message: "Request timeout after 30s", level: "WARN" },
      { message: "Timeout waiting for response", level: "ERROR" },
    ]);

    expect(prismaMock.alertEvent.create).toHaveBeenCalledOnce();
  });

  it("respects severity filter", async () => {
    prismaMock.alertRule.findMany.mockResolvedValue([
      {
        id: "rule-2",
        name: "Error Keyword",
        enabled: true,
        environmentId: "env-1",
        pipelineId: "pipeline-1",
        teamId: "team-1",
        metric: "log_keyword" as never,
        condition: "gt" as never,
        threshold: 0,
        durationSeconds: null,
        cooldownMinutes: 15,
        snoozedUntil: null,
        keyword: "failed",
        keywordSeverityFilter: "ERROR" as never,
        keywordWindowMinutes: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const { refreshKeywordRuleCache } = await import("../keyword-alert");
    await refreshKeywordRuleCache();

    prismaMock.alertEvent.findFirst.mockResolvedValue(null);
    prismaMock.alertEvent.create.mockResolvedValue({} as never);

    // WARN-level line matches keyword but not severity filter
    await checkKeywordMatches("pipeline-1", [
      { message: "Task failed with warning", level: "WARN" },
    ]);

    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();

    // ERROR-level line matches both keyword and severity
    await checkKeywordMatches("pipeline-1", [
      { message: "Task failed critically", level: "ERROR" },
    ]);

    expect(prismaMock.alertEvent.create).toHaveBeenCalledOnce();
  });
});
