import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { infoLog, warnLog, errorLog } from "../logger";

describe("logger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("infoLog", () => {
    it("logs formatted message with timestamp and tag", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      infoLog("test-tag", "hello world");
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "test-tag",
        "hello world",
      );
    });

    it("includes data when provided", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const data = { key: "value" };
      infoLog("test-tag", "with data", data);
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "test-tag",
        "with data",
        data,
      );
    });

    it("sanitizes newlines in tag and message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      infoLog("tag\ninjection", "msg\r\ninjection");
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "taginjection",
        "msginjection",
      );
    });
  });

  describe("warnLog", () => {
    it("logs formatted message via console.warn", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnLog("warn-tag", "something fishy");
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "warn-tag",
        "something fishy",
      );
    });

    it("includes data when provided", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const data = { count: 42 };
      warnLog("warn-tag", "with data", data);
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "warn-tag",
        "with data",
        data,
      );
    });

    it("sanitizes newlines in tag and message", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnLog("tag\ninjection", "msg\r\ninjection");
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "taginjection",
        "msginjection",
      );
    });
  });

  describe("errorLog", () => {
    it("logs formatted message via console.error", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      errorLog("error-tag", "something broke");
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "error-tag",
        "something broke",
      );
    });

    it("includes data when provided", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const err = new Error("boom");
      errorLog("error-tag", "with error", err);
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "error-tag",
        "with error",
        err,
      );
    });

    it("sanitizes newlines in tag and message", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      errorLog("tag\ninjection", "msg\r\ninjection");
      expect(spy).toHaveBeenCalledWith(
        "%s [%s] %s",
        "2025-01-15T10:30:00.000Z",
        "taginjection",
        "msginjection",
      );
    });
  });
});
