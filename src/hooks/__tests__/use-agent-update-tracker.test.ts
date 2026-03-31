import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createUpdateTracker,
  type UpdateStage,
} from "../use-agent-update-tracker";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { toast } from "sonner";

describe("createUpdateTracker (pure state machine)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initial stage is null", () => {
    const tracker = createUpdateTracker(() => {});
    expect(tracker.getStage()).toBeNull();
  });

  it("startTracking sets stage to updating", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.startTracking("node-1", "2.0.0");
    expect(tracker.getStage()).toBe("updating");
    expect(stages).toContain("updating");
  });

  it("fleet_status UNREACHABLE transitions to restarting", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.startTracking("node-1", "2.0.0");
    tracker.handleFleetStatus({
      type: "fleet_status",
      nodeId: "node-1",
      status: "UNREACHABLE",
      timestamp: Date.now(),
    });
    expect(tracker.getStage()).toBe("restarting");
  });

  it("fleet_status HEALTHY after tracking completes the update", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.startTracking("node-1", "2.0.0");
    tracker.handleFleetStatus({
      type: "fleet_status",
      nodeId: "node-1",
      status: "HEALTHY",
      timestamp: Date.now(),
    });
    expect(tracker.getStage()).toBe("complete");
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("updated"),
    );
  });

  it("ignores fleet_status for untracked nodes", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.startTracking("node-1", "2.0.0");
    tracker.handleFleetStatus({
      type: "fleet_status",
      nodeId: "node-OTHER",
      status: "UNREACHABLE",
      timestamp: Date.now(),
    });
    expect(tracker.getStage()).toBe("updating");
  });

  it("timeout fires warning after 60s with no resolution", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.startTracking("node-1", "2.0.0");
    vi.advanceTimersByTime(60_000);
    expect(tracker.getStage()).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("may have failed"),
    );
  });

  it("completing before timeout clears the timer", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.startTracking("node-1", "2.0.0");
    tracker.handleFleetStatus({
      type: "fleet_status",
      nodeId: "node-1",
      status: "HEALTHY",
      timestamp: Date.now(),
    });
    vi.advanceTimersByTime(60_000);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("new startTracking call replaces previous tracking", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.startTracking("node-1", "2.0.0");
    tracker.startTracking("node-2", "3.0.0");
    tracker.handleFleetStatus({
      type: "fleet_status",
      nodeId: "node-1",
      status: "HEALTHY",
      timestamp: Date.now(),
    });
    expect(tracker.getStage()).toBe("updating");
  });

  it("does nothing when not tracking", () => {
    const stages: UpdateStage[] = [];
    const tracker = createUpdateTracker((s) => stages.push(s));
    tracker.handleFleetStatus({
      type: "fleet_status",
      nodeId: "node-1",
      status: "UNREACHABLE",
      timestamp: Date.now(),
    });
    expect(tracker.getStage()).toBeNull();
    expect(stages).toHaveLength(0);
  });
});
