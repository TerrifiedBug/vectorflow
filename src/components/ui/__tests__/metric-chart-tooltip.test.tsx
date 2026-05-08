// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { MetricChart } from "@/components/ui/metric-chart";

describe("MetricChart tooltip", () => {
  it("shows hovered point labels and formatted values", () => {
    const { getByTestId } = render(
      <MetricChart
        width={240}
        height={120}
        series={[{ name: "in", color: "var(--chart-1)", data: [10, 20, 30] }]}
        pointLabels={["-10m", "-5m", "now"]}
        valueFormatter={(value) => `${value} ev/s`}
      />,
    );

    const hitbox = getByTestId("metric-chart-hitbox");
    hitbox.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 240,
      bottom: 120,
      width: 240,
      height: 120,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(hitbox, { clientX: 220, clientY: 40 });

    expect(screen.getByText("now")).toBeInTheDocument();
    expect(screen.getByText("in")).toBeInTheDocument();
    expect(screen.getByText("30 ev/s")).toBeInTheDocument();
  });
});
