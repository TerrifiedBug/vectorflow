import { describe, it, expect } from "vitest";
import { parseLogLine } from "../log-utils";
import type { ParsedLogEntry } from "../log-utils";

const NOW = 1700000000000;

describe("parseLogLine", () => {
  it("parses JSON with level + message fields", () => {
    const raw = JSON.stringify({ level: "error", message: "disk full" });
    const result = parseLogLine(raw, NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "ERROR",
      message: "disk full",
      timestamp: NOW,
    });
  });

  it("parses JSON with level + msg fields (Vector format)", () => {
    const raw = JSON.stringify({ level: "warn", msg: "buffer approaching limit" });
    const result = parseLogLine(raw, NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "WARN",
      message: "buffer approaching limit",
      timestamp: NOW,
    });
  });

  it("prefers msg over message when both are present", () => {
    const raw = JSON.stringify({ level: "info", msg: "primary", message: "secondary" });
    const result = parseLogLine(raw, NOW);
    expect(result.message).toBe("primary");
  });

  it("uses JSON timestamp when present", () => {
    const ts = 1699999999000;
    const raw = JSON.stringify({ level: "info", message: "ok", timestamp: ts });
    const result = parseLogLine(raw, NOW);
    expect(result.timestamp).toBe(ts);
  });

  it("uses ts field as timestamp fallback", () => {
    const ts = 1699999998000;
    const raw = JSON.stringify({ level: "debug", msg: "ok", ts });
    const result = parseLogLine(raw, NOW);
    expect(result.timestamp).toBe(ts);
  });

  it("defaults level to INFO when JSON has no level field", () => {
    const raw = JSON.stringify({ message: "no level here" });
    const result = parseLogLine(raw, NOW);
    expect(result.level).toBe("INFO");
    expect(result.message).toBe("no level here");
  });

  it("parses plain text with [ERROR] prefix", () => {
    const result = parseLogLine("[ERROR] connection refused", NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "ERROR",
      message: "connection refused",
      timestamp: NOW,
    });
  });

  it("parses plain text with WARN: prefix", () => {
    const result = parseLogLine("WARN: slow query detected", NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "WARN",
      message: "slow query detected",
      timestamp: NOW,
    });
  });

  it("parses plain text with lowercase debug prefix", () => {
    const result = parseLogLine("debug entering handler", NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "DEBUG",
      message: "entering handler",
      timestamp: NOW,
    });
  });

  it("parses TRACE level", () => {
    const result = parseLogLine("[TRACE] detailed span", NOW);
    expect(result.level).toBe("TRACE");
    expect(result.message).toBe("detailed span");
  });

  it("defaults to INFO for plain text with no level prefix", () => {
    const result = parseLogLine("some random log output", NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "INFO",
      message: "some random log output",
      timestamp: NOW,
    });
  });

  it("handles empty string", () => {
    const result = parseLogLine("", NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "INFO",
      message: "",
      timestamp: NOW,
    });
  });

  it("handles whitespace-only string", () => {
    const result = parseLogLine("   ", NOW);
    expect(result).toEqual<ParsedLogEntry>({
      level: "INFO",
      message: "",
      timestamp: NOW,
    });
  });

  it("handles malformed JSON (falls through to plain-text)", () => {
    const result = parseLogLine("{not valid json", NOW);
    expect(result.level).toBe("INFO");
    expect(result.message).toBe("{not valid json");
  });

  it("normalizes warning alias to WARN", () => {
    const raw = JSON.stringify({ level: "warning", message: "deprecated" });
    const result = parseLogLine(raw, NOW);
    expect(result.level).toBe("WARN");
  });

  it("normalizes err alias to ERROR", () => {
    const raw = JSON.stringify({ level: "err", msg: "failed" });
    const result = parseLogLine(raw, NOW);
    expect(result.level).toBe("ERROR");
  });
});
