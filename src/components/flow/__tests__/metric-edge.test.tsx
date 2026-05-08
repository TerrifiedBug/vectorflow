// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

// Mock @xyflow/react before importing MetricEdge
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  BaseEdge: ({ style, path }: { style?: React.CSSProperties; path: string }) => (
    <path data-testid="base-edge" d={path} style={style} />
  ),
  getBezierPath: () => ["M0,0 L100,100", 50, 50] as [string, number, number],
}));

import { MetricEdge } from "../metric-edge";
import { Position as PositionEnum } from "@xyflow/react";

const baseEdgeProps = {
  id: "edge-1",
  source: "node-1",
  target: "node-2",
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: PositionEnum.Right,
  targetPosition: PositionEnum.Left,
  markerEnd: undefined,
  selected: false,
  animated: false,
  interactionWidth: 20,
};

describe("MetricEdge", () => {
  describe("gradient stroke", () => {
    it("renders a linearGradient with stops keyed off source/target kinds", () => {
      const { container } = render(
        <svg>
          <MetricEdge
            {...baseEdgeProps}
            data={{ sourceKind: "source", targetKind: "transform" }}
          />
        </svg>,
      );
      // SVG element tag matching is case-sensitive in jsdom — use getElementById.
      const grad = container.querySelector("#metric-edge-grad-edge-1");
      expect(grad).toBeTruthy();
      const stops = grad!.querySelectorAll("stop");
      expect(stops).toHaveLength(2);
      expect(stops[0].getAttribute("stop-color")).toBe("var(--node-source)");
      expect(stops[1].getAttribute("stop-color")).toBe("var(--node-transform)");
    });

    it("paints the visible path with the gradient url and 1.5px stroke", () => {
      const { container } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{}} />
        </svg>,
      );
      const paths = container.querySelectorAll("path");
      const gradientPath = Array.from(paths).find((p) =>
        p.getAttribute("stroke")?.startsWith("url(#metric-edge-grad-"),
      );
      expect(gradientPath).toBeTruthy();
      expect(gradientPath?.getAttribute("stroke-width")).toBe("1.5");
    });

    it("uses 2px stroke when selected", () => {
      const { container } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} selected data={{}} />
        </svg>,
      );
      const paths = container.querySelectorAll("path");
      const gradientPath = Array.from(paths).find((p) =>
        p.getAttribute("stroke")?.startsWith("url(#"),
      );
      expect(gradientPath?.getAttribute("stroke-width")).toBe("2");
    });
  });

  describe("animated flow marker", () => {
    it("renders an animateMotion marker when running with throughput", () => {
      const { container } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{ throughput: 100 }} />
        </svg>,
      );
      const motion = Array.from(container.getElementsByTagName("*")).find(
        (el) => el.tagName.toLowerCase() === "animatemotion",
      );
      expect(motion).toBeTruthy();
      const dur = motion?.getAttribute("dur");
      expect(dur).toMatch(/^[23]\.[0-9]s$/);
      const seconds = parseFloat(dur!.replace("s", ""));
      expect(seconds).toBeGreaterThanOrEqual(2.4);
      expect(seconds).toBeLessThanOrEqual(3.4);
    });

    it("does not render a marker when throughput is zero", () => {
      const { container } = render(
        <svg>
          <MetricEdge {...baseEdgeProps} data={{ throughput: 0 }} />
        </svg>,
      );
      const motion = Array.from(container.getElementsByTagName("*")).find(
        (el) => el.tagName.toLowerCase() === "animatemotion",
      );
      expect(motion).toBeUndefined();
    });

    it("suppresses the marker when running is explicitly false", () => {
      const { container } = render(
        <svg>
          <MetricEdge
            {...baseEdgeProps}
            data={{ throughput: 100, running: false }}
          />
        </svg>,
      );
      const motion = Array.from(container.getElementsByTagName("*")).find(
        (el) => el.tagName.toLowerCase() === "animatemotion",
      );
      expect(motion).toBeUndefined();
    });
  });
});
