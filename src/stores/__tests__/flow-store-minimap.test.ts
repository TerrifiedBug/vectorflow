import { beforeEach, describe, expect, it } from "vitest";
import { useFlowStore } from "@/stores/flow-store";

// UX-1 (editor affordances): the minimap is a per-session UI preference held in
// the flow store, toggled from a canvas control. It must NOT be cleared when the
// graph is reset (it is a viewport pref, not graph state).
beforeEach(() => {
  useFlowStore.setState({ showMinimap: false });
  useFlowStore.getState().clearGraph();
});

describe("flow-store minimap visibility", () => {
  it("defaults showMinimap to false", () => {
    expect(useFlowStore.getState().showMinimap).toBe(false);
  });

  it("toggleMinimap flips the flag on and off", () => {
    const { toggleMinimap } = useFlowStore.getState();
    toggleMinimap();
    expect(useFlowStore.getState().showMinimap).toBe(true);
    toggleMinimap();
    expect(useFlowStore.getState().showMinimap).toBe(false);
  });

  it("keeps the minimap preference across a graph reset (clearGraph)", () => {
    useFlowStore.getState().toggleMinimap();
    expect(useFlowStore.getState().showMinimap).toBe(true);
    useFlowStore.getState().clearGraph();
    expect(useFlowStore.getState().showMinimap).toBe(true);
  });
});
