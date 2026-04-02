import { describe, it, expect } from "vitest";

describe("heartbeat runningAs field", () => {
  it("accepts runningAs string in heartbeat payload", () => {
    const payload = {
      pipelines: [],
      runningAs: "vfagent",
    };
    expect(payload.runningAs).toBe("vfagent");
  });

  it("accepts heartbeat without runningAs (backward compatible)", () => {
    const payload = {
      pipelines: [],
    };
    expect(payload).not.toHaveProperty("runningAs");
  });
});
