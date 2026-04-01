// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockSetCenter = vi.fn();
const mockGetZoom = vi.fn(() => 1);

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    setCenter: mockSetCenter,
    getZoom: mockGetZoom,
  }),
}));

interface FlowStoreState {
  canvasSearchMatchIds: string[];
  canvasSearchActiveIndex: number;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    measured?: { width?: number; height?: number };
  }>;
}

let storeState: FlowStoreState = {
  canvasSearchMatchIds: [],
  canvasSearchActiveIndex: -1,
  nodes: [],
};

vi.mock("@/stores/flow-store", () => ({
  useFlowStore: (selector: (state: FlowStoreState) => unknown) =>
    selector(storeState),
}));

import { useCanvasSearch } from "@/hooks/use-canvas-search";

describe("useCanvasSearch", () => {
  beforeEach(() => {
    mockSetCenter.mockClear();
    mockGetZoom.mockClear();
    storeState = {
      canvasSearchMatchIds: [],
      canvasSearchActiveIndex: -1,
      nodes: [],
    };
  });

  it("does not call setCenter when there are no matches", () => {
    storeState = {
      canvasSearchMatchIds: [],
      canvasSearchActiveIndex: -1,
      nodes: [],
    };

    renderHook(() => useCanvasSearch());

    expect(mockSetCenter).not.toHaveBeenCalled();
  });

  it("pans to node position when there is an active match", () => {
    storeState = {
      canvasSearchMatchIds: ["node-1"],
      canvasSearchActiveIndex: 0,
      nodes: [
        {
          id: "node-1",
          position: { x: 100, y: 200 },
          measured: { width: 300, height: 100 },
        },
      ],
    };

    renderHook(() => useCanvasSearch());

    expect(mockSetCenter).toHaveBeenCalledWith(
      100 + 300 / 2, // x + width/2
      200 + 100 / 2, // y + height/2
      { zoom: 1, duration: 300 },
    );
  });

  it("does not call setCenter when match ID is not found in nodes", () => {
    storeState = {
      canvasSearchMatchIds: ["node-missing"],
      canvasSearchActiveIndex: 0,
      nodes: [
        {
          id: "node-1",
          position: { x: 0, y: 0 },
        },
      ],
    };

    renderHook(() => useCanvasSearch());

    expect(mockSetCenter).not.toHaveBeenCalled();
  });
});
