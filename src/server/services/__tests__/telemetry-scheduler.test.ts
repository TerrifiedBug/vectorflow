import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cronSchedule, sendHeartbeat } = vi.hoisted(() => ({
  cronSchedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  sendHeartbeat: vi.fn(),
}));

vi.mock("node-cron", () => ({ default: { schedule: cronSchedule }, schedule: cronSchedule }));
vi.mock("../telemetry-sender", () => ({ sendTelemetryHeartbeat: sendHeartbeat }));

import { initTelemetryScheduler, _stopTelemetrySchedulerForTests } from "../telemetry-scheduler";

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply the mock return value after clearAllMocks resets it
  cronSchedule.mockReturnValue({ stop: vi.fn() });
});

afterEach(() => {
  _stopTelemetrySchedulerForTests();
});

describe("initTelemetryScheduler", () => {
  it("registers a daily cron job", () => {
    initTelemetryScheduler();
    expect(cronSchedule).toHaveBeenCalledTimes(1);
    const expr = cronSchedule.mock.calls[0][0];
    expect(typeof expr).toBe("string");
    expect(expr.split(" ").length).toBe(5);
  });

  it("invokes sendTelemetryHeartbeat when the cron fires", async () => {
    initTelemetryScheduler();
    const handler = cronSchedule.mock.calls[0][1] as () => Promise<void>;
    await handler();
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("swallows errors from sendTelemetryHeartbeat so the cron task survives", async () => {
    sendHeartbeat.mockRejectedValueOnce(new Error("boom"));
    initTelemetryScheduler();
    const handler = cronSchedule.mock.calls[0][1] as () => Promise<void>;
    await expect(handler()).resolves.toBeUndefined();
  });

  it("is idempotent — calling twice registers only one cron", () => {
    initTelemetryScheduler();
    initTelemetryScheduler();
    expect(cronSchedule).toHaveBeenCalledTimes(1);
  });
});
