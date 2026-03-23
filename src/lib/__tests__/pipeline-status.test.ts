import { describe, it, expect } from "vitest";
import {
  aggregateProcessStatus,
  derivePipelineStatus,
} from "@/lib/pipeline-status";

// ─── aggregateProcessStatus ────────────────────────────────────────────────

describe("aggregateProcessStatus", () => {
  it("returns null for an empty array", () => {
    expect(aggregateProcessStatus([])).toBeNull();
  });

  it("returns RUNNING when all statuses are RUNNING", () => {
    const statuses = [
      { status: "RUNNING" },
      { status: "RUNNING" },
      { status: "RUNNING" },
    ];
    expect(aggregateProcessStatus(statuses)).toBe("RUNNING");
  });

  it("returns CRASHED when any status is CRASHED", () => {
    const statuses = [
      { status: "RUNNING" },
      { status: "CRASHED" },
      { status: "RUNNING" },
    ];
    expect(aggregateProcessStatus(statuses)).toBe("CRASHED");
  });

  it("CRASHED takes priority over STOPPED", () => {
    const statuses = [
      { status: "STOPPED" },
      { status: "CRASHED" },
    ];
    expect(aggregateProcessStatus(statuses)).toBe("CRASHED");
  });

  it("returns STOPPED when any status is STOPPED (no CRASHED)", () => {
    const statuses = [
      { status: "RUNNING" },
      { status: "STOPPED" },
      { status: "RUNNING" },
    ];
    expect(aggregateProcessStatus(statuses)).toBe("STOPPED");
  });

  it("returns STARTING when any status is STARTING (no CRASHED/STOPPED)", () => {
    const statuses = [
      { status: "RUNNING" },
      { status: "STARTING" },
    ];
    expect(aggregateProcessStatus(statuses)).toBe("STARTING");
  });

  it("returns PENDING when any status is PENDING (no CRASHED/STOPPED/STARTING)", () => {
    const statuses = [
      { status: "RUNNING" },
      { status: "PENDING" },
    ];
    expect(aggregateProcessStatus(statuses)).toBe("PENDING");
  });

  it("handles a single RUNNING status", () => {
    expect(aggregateProcessStatus([{ status: "RUNNING" }])).toBe("RUNNING");
  });

  it("handles a single CRASHED status", () => {
    expect(aggregateProcessStatus([{ status: "CRASHED" }])).toBe("CRASHED");
  });

  it("priority order: CRASHED > STOPPED > STARTING > PENDING > RUNNING", () => {
    const all = [
      { status: "RUNNING" },
      { status: "PENDING" },
      { status: "STARTING" },
      { status: "STOPPED" },
      { status: "CRASHED" },
    ];
    expect(aggregateProcessStatus(all)).toBe("CRASHED");

    const nocrash = [
      { status: "RUNNING" },
      { status: "PENDING" },
      { status: "STARTING" },
      { status: "STOPPED" },
    ];
    expect(aggregateProcessStatus(nocrash)).toBe("STOPPED");

    const nostop = [
      { status: "RUNNING" },
      { status: "PENDING" },
      { status: "STARTING" },
    ];
    expect(aggregateProcessStatus(nostop)).toBe("STARTING");

    const nopending = [
      { status: "RUNNING" },
      { status: "PENDING" },
    ];
    expect(aggregateProcessStatus(nopending)).toBe("PENDING");
  });
});

// ─── derivePipelineStatus ──────────────────────────────────────────────────

describe("derivePipelineStatus", () => {
  it("returns PENDING for an empty nodes array", () => {
    expect(derivePipelineStatus([])).toBe("PENDING");
  });

  it("returns CRASHED when any node is CRASHED", () => {
    const nodes = [
      { pipelineStatus: "RUNNING" },
      { pipelineStatus: "CRASHED" },
    ];
    expect(derivePipelineStatus(nodes)).toBe("CRASHED");
  });

  it("returns RUNNING when any node is RUNNING (no CRASHED)", () => {
    const nodes = [
      { pipelineStatus: "STOPPED" },
      { pipelineStatus: "RUNNING" },
    ];
    expect(derivePipelineStatus(nodes)).toBe("RUNNING");
  });

  it("returns STARTING when any node is STARTING (no CRASHED/RUNNING)", () => {
    const nodes = [
      { pipelineStatus: "STOPPED" },
      { pipelineStatus: "STARTING" },
    ];
    expect(derivePipelineStatus(nodes)).toBe("STARTING");
  });

  it("returns STOPPED when all nodes are STOPPED", () => {
    const nodes = [
      { pipelineStatus: "STOPPED" },
      { pipelineStatus: "STOPPED" },
    ];
    expect(derivePipelineStatus(nodes)).toBe("STOPPED");
  });

  it("falls back to first node status for unrecognized combinations", () => {
    const nodes = [
      { pipelineStatus: "PENDING" },
      { pipelineStatus: "STOPPED" },
    ];
    // Not all STOPPED, no CRASHED/RUNNING/STARTING → fallback to first
    expect(derivePipelineStatus(nodes)).toBe("PENDING");
  });

  it("handles single node — returns its status", () => {
    expect(derivePipelineStatus([{ pipelineStatus: "RUNNING" }])).toBe("RUNNING");
    expect(derivePipelineStatus([{ pipelineStatus: "CRASHED" }])).toBe("CRASHED");
    expect(derivePipelineStatus([{ pipelineStatus: "STOPPED" }])).toBe("STOPPED");
    expect(derivePipelineStatus([{ pipelineStatus: "PENDING" }])).toBe("PENDING");
  });

  it("CRASHED takes priority over RUNNING", () => {
    const nodes = [
      { pipelineStatus: "RUNNING" },
      { pipelineStatus: "CRASHED" },
      { pipelineStatus: "RUNNING" },
    ];
    expect(derivePipelineStatus(nodes)).toBe("CRASHED");
  });

  it("all RUNNING returns RUNNING", () => {
    const nodes = [
      { pipelineStatus: "RUNNING" },
      { pipelineStatus: "RUNNING" },
    ];
    expect(derivePipelineStatus(nodes)).toBe("RUNNING");
  });
});
