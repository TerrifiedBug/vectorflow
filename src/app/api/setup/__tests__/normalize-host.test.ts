import { describe, expect, it, vi } from "vitest";

// The route handler imports heavy NextAuth / Prisma surfaces that
// vitest would have to mock to import the module. Tests below only
// exercise the pure `normalizeHostValue` helper, so we mock the
// transitive dependencies with no-op stubs.
vi.mock("@/server/services/setup", () => ({
  isSetupRequired: vi.fn(),
  completeSetup: vi.fn(),
  SetupAlreadyCompletedError: class extends Error {},
}));
vi.mock("@/app/api/_lib/ip-rate-limit", () => ({
  checkIpRateLimit: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  debugLog: vi.fn(),
}));
vi.mock("@/server/services/telemetry-sender", () => ({
  sendTelemetryHeartbeat: vi.fn(),
}));

import * as route from "@/app/api/setup/route";

const { normalizeHostValue } = route.__test__;

describe("normalizeHostValue", () => {
  it("returns null for null/undefined/empty", () => {
    expect(normalizeHostValue(null)).toBeNull();
    expect(normalizeHostValue(undefined)).toBeNull();
    expect(normalizeHostValue("")).toBeNull();
  });

  it("lowercases case differences so EXAMPLE.COM matches example.com", () => {
    expect(normalizeHostValue("EXAMPLE.COM")).toBe("example.com");
    expect(normalizeHostValue("Example.COM:443")).toBe("example.com");
  });

  it("strips the :port suffix consistently", () => {
    expect(normalizeHostValue("example.com:443")).toBe("example.com");
    expect(normalizeHostValue("example.com")).toBe("example.com");
  });

  it("strips https:// scheme from origin URLs", () => {
    expect(normalizeHostValue("https://example.com")).toBe("example.com");
    expect(normalizeHostValue("https://EXAMPLE.com:8080")).toBe("example.com");
  });

  it("handles IPv6 with brackets", () => {
    expect(normalizeHostValue("[::1]:3000")).toBe("::1");
    expect(normalizeHostValue("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("returns null when the origin URL is unparseable", () => {
    expect(normalizeHostValue("https://[invalid")).toBeNull();
  });
});
