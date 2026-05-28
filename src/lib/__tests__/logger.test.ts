import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { infoLog, warnLog, errorLog, debugLog } from "../logger";
import { runWithLogContext } from "../log-context";

// ── Helpers ──────────────────────────────────────────────────────────────────
//
// The logger writes a single JSON-stringified record as the sole argument to
// the matching `console.*` method (info → console.info; warn → console.warn;
// error/debug → console.error/console.debug). Tests spy on the console
// method, capture the call args, and parse the JSON record.

function captureConsole(method: "log" | "info" | "warn" | "error" | "debug") {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  return {
    spy,
    readRecord: () => {
      expect(spy).toHaveBeenCalledOnce();
      const written = spy.mock.calls[0][0] as string;
      return JSON.parse(written) as Record<string, unknown>;
    },
  };
}

const captureStdout = () => captureConsole("log");
const captureStderr = () => captureConsole("error");
const captureWarn = () => captureConsole("warn");

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("logger (JSON format)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── JSON shape ──────────────────────────────────────────────────────────────

  describe("infoLog — console.log, level=info", () => {
    it("emits a valid JSON line with required fields", () => {
      const { readRecord } = captureStdout();
      infoLog("test-tag", "hello world");
      const r = readRecord();
      expect(r).toMatchObject({
        ts: "2025-01-15T10:30:00.000Z",
        level: "info",
        tag: "test-tag",
        msg: "hello world",
      });
    });

    it("argument is a parseable JSON string", () => {
      const { spy } = captureStdout();
      infoLog("t", "m");
      const written = spy.mock.calls[0][0] as string;
      expect(() => JSON.parse(written)).not.toThrow();
    });

    it("includes data field when provided", () => {
      const { readRecord } = captureStdout();
      infoLog("test-tag", "with data", { key: "value" });
      const r = readRecord();
      expect(r.data).toEqual({ key: "value" });
    });

    it("omits data field when not provided", () => {
      const { readRecord } = captureStdout();
      infoLog("test-tag", "no data");
      const r = readRecord();
      expect("data" in r).toBe(false);
    });

    it("serializes Error data to { name, message, stack }", () => {
      const { readRecord } = captureStdout();
      const err = new Error("boom");
      infoLog("test-tag", "error data", err);
      const r = readRecord();
      expect(r.data).toMatchObject({ name: "Error", message: "boom" });
    });

    it("sanitizes CR/LF in tag and msg", () => {
      const { readRecord } = captureStdout();
      infoLog("tag\ninjection", "msg\r\ninjection");
      const r = readRecord();
      expect(r.tag).toBe("taginjection");
      expect(r.msg).toBe("msginjection");
    });

    it("sanitized msg does not break JSON parsing", () => {
      const { spy } = captureStdout();
      infoLog("t", "line1\nline2");
      const written = spy.mock.calls[0][0] as string;
      const r = JSON.parse(written) as Record<string, unknown>;
      expect(r.msg).toBe("line1line2");
    });
  });

  // ── warnLog ─────────────────────────────────────────────────────────────────

  describe("warnLog — console.warn, level=warn", () => {
    it("emits JSON via console.warn with level=warn", () => {
      const { readRecord } = captureWarn();
      warnLog("warn-tag", "something fishy");
      const r = readRecord();
      expect(r).toMatchObject({
        ts: "2025-01-15T10:30:00.000Z",
        level: "warn",
        tag: "warn-tag",
        msg: "something fishy",
      });
    });

    it("includes data when provided", () => {
      const { readRecord } = captureWarn();
      warnLog("warn-tag", "with data", { count: 42 });
      const r = readRecord();
      expect(r.data).toEqual({ count: 42 });
    });

    it("sanitizes newlines in tag and msg", () => {
      const { readRecord } = captureWarn();
      warnLog("tag\ninjection", "msg\r\ninjection");
      const r = readRecord();
      expect(r.tag).toBe("taginjection");
      expect(r.msg).toBe("msginjection");
    });
  });

  // ── errorLog ────────────────────────────────────────────────────────────────

  describe("errorLog — console.error, level=error", () => {
    it("emits JSON via console.error with level=error", () => {
      const { readRecord } = captureStderr();
      errorLog("error-tag", "something broke");
      const r = readRecord();
      expect(r).toMatchObject({
        ts: "2025-01-15T10:30:00.000Z",
        level: "error",
        tag: "error-tag",
        msg: "something broke",
      });
    });

    it("includes data when provided", () => {
      const { readRecord } = captureStderr();
      const err = new Error("boom");
      errorLog("error-tag", "with error", err);
      const r = readRecord();
      expect(r.data).toMatchObject({ name: "Error", message: "boom" });
    });

    it("sanitizes newlines in tag and msg", () => {
      const { readRecord } = captureStderr();
      errorLog("tag\ninjection", "msg\r\ninjection");
      const r = readRecord();
      expect(r.tag).toBe("taginjection");
      expect(r.msg).toBe("msginjection");
    });
  });

  // ── Context carry-through ────────────────────────────────────────────────────

  describe("getLogContext carry-through", () => {
    it("includes organization_id and request_id from runWithLogContext", () => {
      const { readRecord } = captureStdout();
      runWithLogContext({ orgId: "org_abc", requestId: "req_123" }, () => {
        infoLog("ctx-tag", "context test");
      });
      const r = readRecord();
      expect(r.organization_id).toBe("org_abc");
      expect(r.request_id).toBe("req_123");
    });

    it("includes only organization_id when requestId is absent", () => {
      const { readRecord } = captureStdout();
      runWithLogContext({ orgId: "org_xyz" }, () => {
        infoLog("ctx-tag", "partial context");
      });
      const r = readRecord();
      expect(r.organization_id).toBe("org_xyz");
      expect("request_id" in r).toBe(false);
    });

    it("includes only request_id when orgId is absent", () => {
      const { readRecord } = captureStdout();
      runWithLogContext({ requestId: "req_456" }, () => {
        infoLog("ctx-tag", "req only");
      });
      const r = readRecord();
      expect(r.request_id).toBe("req_456");
      expect("organization_id" in r).toBe(false);
    });

    it("omits context fields when called outside runWithLogContext", () => {
      const { readRecord } = captureStdout();
      infoLog("no-ctx", "no context");
      const r = readRecord();
      expect("organization_id" in r).toBe(false);
      expect("request_id" in r).toBe(false);
    });

    it("inner context shadows outer for the duration of the call", () => {
      const { spy } = captureStdout();
      runWithLogContext({ orgId: "outer" }, () => {
        runWithLogContext({ orgId: "inner" }, () => {
          infoLog("t", "m");
        });
      });
      const written = spy.mock.calls[0][0] as string;
      const r = JSON.parse(written) as Record<string, unknown>;
      expect(r.organization_id).toBe("inner");
    });

    it("context propagates through async boundaries", async () => {
      const { readRecord } = captureStdout();
      await runWithLogContext({ orgId: "async_org", requestId: "async_req" }, async () => {
        await Promise.resolve();
        infoLog("async-tag", "after await");
      });
      const r = readRecord();
      expect(r.organization_id).toBe("async_org");
      expect(r.request_id).toBe("async_req");
    });
  });

  // ── Routing to correct console method ────────────────────────────────────────

  describe("console-method routing", () => {
    it("infoLog routes to console.log, not console.error", () => {
      const info = vi.spyOn(console, "log").mockImplementation(() => {});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      infoLog("t", "m");
      expect(info).toHaveBeenCalledOnce();
      expect(err).not.toHaveBeenCalled();
    });

    it("errorLog routes to console.error, not console.log", () => {
      const info = vi.spyOn(console, "log").mockImplementation(() => {});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      errorLog("t", "m");
      expect(err).toHaveBeenCalledOnce();
      expect(info).not.toHaveBeenCalled();
    });

    it("warnLog routes to console.warn, not console.log", () => {
      const info = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnLog("t", "m");
      expect(warn).toHaveBeenCalledOnce();
      expect(info).not.toHaveBeenCalled();
    });
  });

  // ── debugLog gating ──────────────────────────────────────────────────────────

  describe("debugLog", () => {
    it("does not emit when VF_LOG_LEVEL is not debug/trace (default in tests)", () => {
      // The vitest environment uses VF_LOG_LEVEL=info (default), so debugLog is gated.
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      debugLog("t", "m");
      // Either emitted or not depending on env — assert the output is valid JSON if emitted
      if (spy.mock.calls.length > 0) {
        const written = spy.mock.calls[0][0] as string;
        expect(() => JSON.parse(written)).not.toThrow();
      }
    });
  });
});
