// src/stores/__tests__/deploy-progress-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDeployProgressStore } from "@/stores/deploy-progress-store";

describe("deploy-progress-store", () => {
  beforeEach(() => {
    // Reset store to initial state
    useDeployProgressStore.setState({
      isActive: false,
      total: 0,
      completed: 0,
      failed: 0,
      results: [],
      toastId: null,
    });
  });

  it("startDeploy initializes state with pending pipelines", () => {
    useDeployProgressStore.getState().startDeploy([
      { id: "p1", name: "Pipeline A" },
      { id: "p2", name: "Pipeline B" },
    ]);

    const state = useDeployProgressStore.getState();
    expect(state.isActive).toBe(true);
    expect(state.total).toBe(2);
    expect(state.completed).toBe(0);
    expect(state.failed).toBe(0);
    expect(state.results).toHaveLength(2);
    expect(state.results[0]).toEqual({
      pipelineId: "p1",
      pipelineName: "Pipeline A",
      status: "pending",
    });
  });

  it("updateResult tracks individual pipeline completion", () => {
    useDeployProgressStore.getState().startDeploy([
      { id: "p1", name: "Pipeline A" },
      { id: "p2", name: "Pipeline B" },
    ]);

    useDeployProgressStore.getState().updateResult("p1", "success");

    const state = useDeployProgressStore.getState();
    expect(state.completed).toBe(1);
    expect(state.failed).toBe(0);
    expect(state.results[0].status).toBe("success");
    expect(state.results[1].status).toBe("pending");
  });

  it("updateResult tracks failures with error messages", () => {
    useDeployProgressStore.getState().startDeploy([
      { id: "p1", name: "Pipeline A" },
    ]);

    useDeployProgressStore.getState().updateResult("p1", "failed", "No nodes available");

    const state = useDeployProgressStore.getState();
    expect(state.completed).toBe(1);
    expect(state.failed).toBe(1);
    expect(state.results[0].status).toBe("failed");
    expect(state.results[0].error).toBe("No nodes available");
  });

  it("finishDeploy sets final results from mutation response", () => {
    useDeployProgressStore.getState().startDeploy([
      { id: "p1", name: "Pipeline A" },
      { id: "p2", name: "Pipeline B" },
      { id: "p3", name: "Pipeline C" },
    ]);

    const nameMap = new Map([
      ["p1", "Pipeline A"],
      ["p2", "Pipeline B"],
      ["p3", "Pipeline C"],
    ]);

    useDeployProgressStore.getState().finishDeploy(
      [
        { pipelineId: "p1", success: true },
        { pipelineId: "p2", success: false, error: "Timeout" },
        { pipelineId: "p3", success: true },
      ],
      nameMap,
    );

    const state = useDeployProgressStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.total).toBe(3);
    expect(state.completed).toBe(3);
    expect(state.failed).toBe(1);
    expect(state.results[1]).toEqual({
      pipelineId: "p2",
      pipelineName: "Pipeline B",
      status: "failed",
      error: "Timeout",
    });
  });

  it("dismiss resets all state", () => {
    useDeployProgressStore.getState().startDeploy([
      { id: "p1", name: "Pipeline A" },
    ]);
    useDeployProgressStore.getState().setToastId("toast-123");

    useDeployProgressStore.getState().dismiss();

    const state = useDeployProgressStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.total).toBe(0);
    expect(state.results).toHaveLength(0);
    expect(state.toastId).toBeNull();
  });

  it("setToastId stores the Sonner toast identifier", () => {
    useDeployProgressStore.getState().setToastId("toast-456");
    expect(useDeployProgressStore.getState().toastId).toBe("toast-456");
  });
});
