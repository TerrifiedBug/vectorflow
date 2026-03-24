import { describe, it, expect } from "vitest";
import type { LogEntryEvent } from "@/lib/sse/types";
import {
  fingerprint,
  pruneFingerprints,
  isDuplicate,
  appendToBuffer,
  matchesFilter,
  MAX_BUFFER_SIZE,
} from "../use-streaming-logs";

// ── Fixtures ─────────────────────────────────────────────────────────

function makeLogEvent(
  overrides: Partial<LogEntryEvent> = {},
): LogEntryEvent {
  return {
    type: "log_entry",
    nodeId: "node-1",
    pipelineId: "pipe-1",
    lines: ['{"level":"info","msg":"hello"}'],
    ...overrides,
  };
}

// ── fingerprint ──────────────────────────────────────────────────────

describe("fingerprint", () => {
  it("returns level:message format", () => {
    expect(fingerprint("ERROR", "something broke")).toBe(
      "ERROR:something broke",
    );
  });

  it("truncates message at 80 chars", () => {
    const longMsg = "x".repeat(120);
    const fp = fingerprint("INFO", longMsg);
    expect(fp).toBe("INFO:" + "x".repeat(80));
  });

  it("handles empty message", () => {
    expect(fingerprint("DEBUG", "")).toBe("DEBUG:");
  });
});

// ── pruneFingerprints ────────────────────────────────────────────────

describe("pruneFingerprints", () => {
  it("removes expired records", () => {
    const now = 10_000;
    const records = [
      { fp: "a", expiresAt: 5_000 }, // expired
      { fp: "b", expiresAt: 15_000 }, // still valid
      { fp: "c", expiresAt: 10_000 }, // exactly at now — expired (> not >=)
    ];
    const result = pruneFingerprints(records, now);
    expect(result).toEqual([{ fp: "b", expiresAt: 15_000 }]);
  });

  it("returns empty array when all expired", () => {
    const records = [
      { fp: "a", expiresAt: 100 },
      { fp: "b", expiresAt: 200 },
    ];
    expect(pruneFingerprints(records, 1000)).toEqual([]);
  });

  it("returns all records when none expired", () => {
    const records = [
      { fp: "a", expiresAt: 2000 },
      { fp: "b", expiresAt: 3000 },
    ];
    expect(pruneFingerprints(records, 1000)).toEqual(records);
  });
});

// ── isDuplicate ──────────────────────────────────────────────────────

describe("isDuplicate", () => {
  it("returns true when fingerprint exists and not expired", () => {
    const records = [{ fp: "ERROR:boom", expiresAt: 20_000 }];
    expect(isDuplicate(records, "ERROR:boom", 10_000)).toBe(true);
  });

  it("returns false when fingerprint exists but expired", () => {
    const records = [{ fp: "ERROR:boom", expiresAt: 5_000 }];
    expect(isDuplicate(records, "ERROR:boom", 10_000)).toBe(false);
  });

  it("returns false when fingerprint not present", () => {
    const records = [{ fp: "INFO:ok", expiresAt: 20_000 }];
    expect(isDuplicate(records, "ERROR:boom", 10_000)).toBe(false);
  });

  it("returns false for empty records", () => {
    expect(isDuplicate([], "INFO:test", 10_000)).toBe(false);
  });
});

// ── appendToBuffer ───────────────────────────────────────────────────

describe("appendToBuffer", () => {
  it("appends entries when under max size", () => {
    const buffer = [{ id: "1", level: "INFO", message: "a", timestamp: 1 }];
    const newEntries = [
      { id: "2", level: "ERROR", message: "b", timestamp: 2 },
    ];
    const result = appendToBuffer(buffer, newEntries, 10);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[1].id).toBe("2");
  });

  it("drops oldest entries when exceeding max size", () => {
    const buffer = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      level: "INFO",
      message: `msg-${i}`,
      timestamp: i,
    }));
    const newEntries = [
      { id: "new", level: "WARN", message: "new-msg", timestamp: 100 },
    ];
    const result = appendToBuffer(buffer, newEntries, 5);
    expect(result).toHaveLength(5);
    // First entry should be buffer[1] (buffer[0] was dropped)
    expect(result[0].id).toBe("1");
    expect(result[4].id).toBe("new");
  });

  it("caps at MAX_BUFFER_SIZE constant", () => {
    const buffer = Array.from({ length: MAX_BUFFER_SIZE }, (_, i) => ({
      id: String(i),
      level: "INFO",
      message: `msg-${i}`,
      timestamp: i,
    }));
    const newEntries = Array.from({ length: 10 }, (_, i) => ({
      id: `new-${i}`,
      level: "DEBUG",
      message: `new-${i}`,
      timestamp: 1000 + i,
    }));
    const result = appendToBuffer(buffer, newEntries, MAX_BUFFER_SIZE);
    expect(result).toHaveLength(MAX_BUFFER_SIZE);
    // Oldest 10 from buffer should be gone
    expect(result[0].id).toBe("10");
    expect(result[result.length - 1].id).toBe("new-9");
  });

  it("handles empty buffer", () => {
    const newEntries = [
      { id: "1", level: "INFO", message: "a", timestamp: 1 },
    ];
    const result = appendToBuffer([], newEntries, 100);
    expect(result).toEqual(newEntries);
  });

  it("handles empty new entries", () => {
    const buffer = [{ id: "1", level: "INFO", message: "a", timestamp: 1 }];
    const result = appendToBuffer(buffer, [], 100);
    expect(result).toEqual(buffer);
  });
});

// ── matchesFilter ────────────────────────────────────────────────────

describe("matchesFilter", () => {
  it("matches when no filter is set", () => {
    const event = makeLogEvent();
    expect(matchesFilter(event, {})).toBe(true);
  });

  it("matches when pipelineId filter matches", () => {
    const event = makeLogEvent({ pipelineId: "pipe-1" });
    expect(matchesFilter(event, { pipelineId: "pipe-1" })).toBe(true);
  });

  it("rejects when pipelineId filter does not match", () => {
    const event = makeLogEvent({ pipelineId: "pipe-1" });
    expect(matchesFilter(event, { pipelineId: "pipe-2" })).toBe(false);
  });

  it("matches when nodeId filter matches", () => {
    const event = makeLogEvent({ nodeId: "node-1" });
    expect(matchesFilter(event, { nodeId: "node-1" })).toBe(true);
  });

  it("rejects when nodeId filter does not match", () => {
    const event = makeLogEvent({ nodeId: "node-1" });
    expect(matchesFilter(event, { nodeId: "node-2" })).toBe(false);
  });

  it("matches when both filters match", () => {
    const event = makeLogEvent({ pipelineId: "pipe-1", nodeId: "node-1" });
    expect(
      matchesFilter(event, { pipelineId: "pipe-1", nodeId: "node-1" }),
    ).toBe(true);
  });

  it("rejects when one filter matches but the other does not", () => {
    const event = makeLogEvent({ pipelineId: "pipe-1", nodeId: "node-1" });
    expect(
      matchesFilter(event, { pipelineId: "pipe-1", nodeId: "node-X" }),
    ).toBe(false);
  });
});
