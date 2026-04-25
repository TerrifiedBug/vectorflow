import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDemoMode", () => {
  it("returns true when VF_DEMO_MODE=true", async () => {
    vi.stubEnv("VF_DEMO_MODE", "true");
    const { isDemoMode } = await import("../is-demo-mode");
    expect(isDemoMode()).toBe(true);
  });

  it("returns false when VF_DEMO_MODE=false", async () => {
    vi.stubEnv("VF_DEMO_MODE", "false");
    const { isDemoMode } = await import("../is-demo-mode");
    expect(isDemoMode()).toBe(false);
  });

  it("returns false when VF_DEMO_MODE is unset", async () => {
    // Unset the env var to trigger the default value
    delete process.env.VF_DEMO_MODE;
    vi.resetModules();
    const { isDemoMode } = await import("../is-demo-mode");
    expect(isDemoMode()).toBe(false);
  });
});
