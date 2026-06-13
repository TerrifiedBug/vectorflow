import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Sentry SDK so we can assert errorLog's forwarding behaviour
// without an initialised client. `vi.hoisted` lets the mock factory
// reference these stubs safely (the factory is hoisted above imports).
const h = vi.hoisted(() => ({
  captureException: vi.fn(),
  client: { present: true } as { present: boolean },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: h.captureException,
  getClient: () => (h.client.present ? {} : undefined),
}));

import { errorLog } from "../logger";

describe("errorLog → Sentry forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.client.present = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("captures the Error when data is an Error and a client is active", () => {
    const err = new Error("boom");
    errorLog("svc", "it broke", err);
    expect(h.captureException).toHaveBeenCalledTimes(1);
    expect(h.captureException.mock.calls[0][0]).toBe(err);
    expect(h.captureException.mock.calls[0][1]).toMatchObject({
      tags: { log_tag: "svc" },
      extra: { message: "it broke" },
    });
  });

  it("extracts a nested Error from { error }", () => {
    const err = new Error("nested");
    errorLog("svc", "wrapped", { error: err });
    expect(h.captureException).toHaveBeenCalledTimes(1);
    expect(h.captureException.mock.calls[0][0]).toBe(err);
  });

  it("does nothing when Sentry has no active client", () => {
    h.client.present = false;
    errorLog("svc", "broke", new Error("x"));
    expect(h.captureException).not.toHaveBeenCalled();
  });

  it("does nothing when data carries no Error", () => {
    errorLog("svc", "plain", { status: 500 });
    expect(h.captureException).not.toHaveBeenCalled();
  });

  it("sanitizes CR/LF out of the tag forwarded to Sentry", () => {
    errorLog("svc\ninject", "msg", new Error("x"));
    expect(h.captureException.mock.calls[0][1]).toMatchObject({
      tags: { log_tag: "svcinject" },
    });
  });
});
