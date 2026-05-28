import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  runWithLogContext,
  getLogContext,
  formatLogContext,
} from "../log-context";

describe("runWithLogContext + getLogContext", () => {
  it("returns undefined outside any run", () => {
    expect(getLogContext()).toBeUndefined();
  });

  it("makes the ctx visible synchronously inside the run", () => {
    runWithLogContext({ orgId: "org-a", requestId: "r-1" }, () => {
      const ctx = getLogContext();
      expect(ctx).toEqual({ orgId: "org-a", requestId: "r-1" });
    });
  });

  it("propagates across await boundaries", async () => {
    await runWithLogContext({ orgId: "org-a" }, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(getLogContext()).toEqual({ orgId: "org-a" });
    });
  });

  it("propagates into setImmediate callbacks", async () => {
    const seen = await runWithLogContext({ orgId: "org-b" }, () => {
      return new Promise<string | undefined>((resolve) => {
        setImmediate(() => resolve(getLogContext()?.orgId));
      });
    });
    expect(seen).toBe("org-b");
  });

  it("inner run shadows outer for its scope but outer is restored after", () => {
    runWithLogContext({ orgId: "outer" }, () => {
      runWithLogContext({ orgId: "inner" }, () => {
        expect(getLogContext()?.orgId).toBe("inner");
      });
      expect(getLogContext()?.orgId).toBe("outer");
    });
    expect(getLogContext()).toBeUndefined();
  });

  it("inner run merges with outer when only some fields are set", () => {
    runWithLogContext({ orgId: "outer", requestId: "r-1" }, () => {
      runWithLogContext({ orgId: "inner" }, () => {
        const ctx = getLogContext();
        expect(ctx?.orgId).toBe("inner");
        // requestId from the outer scope is preserved.
        expect(ctx?.requestId).toBe("r-1");
      });
    });
  });

  it("parallel runs do not bleed into each other", async () => {
    const seenA: (string | undefined)[] = [];
    const seenB: (string | undefined)[] = [];
    await Promise.all([
      runWithLogContext({ orgId: "A" }, async () => {
        await Promise.resolve();
        seenA.push(getLogContext()?.orgId);
        await new Promise((r) => setTimeout(r, 1));
        seenA.push(getLogContext()?.orgId);
      }),
      runWithLogContext({ orgId: "B" }, async () => {
        await Promise.resolve();
        seenB.push(getLogContext()?.orgId);
        await new Promise((r) => setTimeout(r, 1));
        seenB.push(getLogContext()?.orgId);
      }),
    ]);
    expect(seenA).toEqual(["A", "A"]);
    expect(seenB).toEqual(["B", "B"]);
  });
});

describe("formatLogContext", () => {
  it("returns empty string for undefined or empty ctx", () => {
    expect(formatLogContext(undefined)).toBe("");
    expect(formatLogContext({})).toBe("");
  });

  it("formats orgId only", () => {
    expect(formatLogContext({ orgId: "org-a" })).toBe("{org=org-a} ");
  });

  it("formats requestId only", () => {
    expect(formatLogContext({ requestId: "r-1" })).toBe("{req=r-1} ");
  });

  it("formats both in stable order (org then req)", () => {
    expect(formatLogContext({ orgId: "o", requestId: "r" })).toBe(
      "{org=o req=r} ",
    );
  });
});

describe("logger picks up context", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("infoLog records orgId+requestId from context as JSON fields", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { infoLog } = await import("../logger");
    runWithLogContext({ orgId: "org-x", requestId: "rq-9" }, () => {
      infoLog("tag", "hello");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(record.organization_id).toBe("org-x");
    expect(record.request_id).toBe("rq-9");
    expect(record.msg).toBe("hello");
  });

  it("infoLog emits the original message verbatim outside a context", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { infoLog } = await import("../logger");
    infoLog("tag", "no-context");
    expect(spy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(record.msg).toBe("no-context");
    expect("organization_id" in record).toBe(false);
    expect("request_id" in record).toBe(false);
  });

  it("errorLog also picks up the context as a JSON field", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { errorLog } = await import("../logger");
    runWithLogContext({ orgId: "org-z" }, () => {
      errorLog("tag", "boom");
    });
    const record = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(record.organization_id).toBe("org-z");
    expect(record.msg).toBe("boom");
  });
});
