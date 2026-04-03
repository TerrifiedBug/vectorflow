// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

// Mock @xyflow/react before importing MetricEdge
vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ style, path }: { style?: React.CSSProperties; path: string }) => (
    <path data-testid="base-edge" d={path} style={style} />
  ),
  getBezierPath: () => ["M0,0 L100,100", 50, 50] as [string, number, number],
}));

import { MetricEdge } from "../metric-edge";

const baseEdgeProps = {
  id: "edge-1",
  source: "node-1",
  target: "node-2",
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: "right" as const,
  targetPosition: "left" as const,
  markerEnd: undefined,
  selected: false,
  animated: false,
  interactionWidth: 20,
};

describe("MetricEdge", () => {
  describe("throughput label rendering", () => {
    it("renders no throughput label when data has no throughput", () => {
      const { queryByText } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{}} />
        </svg>
      );
      expect(queryByText(/\/s/)).toBeNull();
      expect(queryByText(/k\/s/)).toBeNull();
    });

    it("renders throughput as '{n}/s' when throughput is below 1000", () => {
      const { getByText } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{ throughput: 250 }} />
        </svg>
      );
      expect(getByText("250/s")).toBeTruthy();
    });

    it("renders throughput as '{n}k/s' when throughput is 1000 or above", () => {
      const { getByText } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{ throughput: 3500 }} />
        </svg>
      );
      expect(getByText("3.5k/s")).toBeTruthy();
    });
  });

  describe("active animation", () => {
    it("applies animation style when throughput is above zero", () => {
      const { container } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{ throughput: 1 }} />
        </svg>
      );
      // The visible animated path has inline animation style
      const paths = container.querySelectorAll("path");
      const animatedPath = Array.from(paths).find(
        (p) => p.style.animation !== ""
      );
      expect(animatedPath).toBeTruthy();
    });

    it("does not apply animation style when throughput is zero", () => {
      const { container } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{ throughput: 0 }} />
        </svg>
      );
      const paths = container.querySelectorAll("path");
      const animatedPaths = Array.from(paths).filter(
        (p) => p.style.animation !== ""
      );
      expect(animatedPaths).toHaveLength(0);
    });

    it("applies stroke-dasharray when active", () => {
      const { container } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{ throughput: 100 }} />
        </svg>
      );
      const paths = container.querySelectorAll("path");
      const dashedPath = Array.from(paths).find(
        (p) => p.getAttribute("stroke-dasharray") !== null
      );
      expect(dashedPath).toBeTruthy();
    });
  });
});
