import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDemoMode", () => {
  it("returns true when NEXT_PUBLIC_VF_DEMO_MODE=true", async () => {
    vi.stubEnv("NEXT_PUBLIC_VF_DEMO_MODE", "true");
    const { isDemoMode } = await import("../is-demo-mode");
    expect(isDemoMode()).toBe(true);
  });

  it("returns false when NEXT_PUBLIC_VF_DEMO_MODE=false", async () => {
    vi.stubEnv("NEXT_PUBLIC_VF_DEMO_MODE", "false");
    const { isDemoMode } = await import("../is-demo-mode");
    expect(isDemoMode()).toBe(false);
  });

  it("returns false when NEXT_PUBLIC_VF_DEMO_MODE is unset", async () => {
    // Stub to empty string — the helper checks === "true", so "" → false
    vi.stubEnv("NEXT_PUBLIC_VF_DEMO_MODE", "");
    vi.resetModules();
    const { isDemoMode } = await import("../is-demo-mode");
    expect(isDemoMode()).toBe(false);
  });
});
