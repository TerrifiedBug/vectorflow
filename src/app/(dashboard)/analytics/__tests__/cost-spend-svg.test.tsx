// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { SpendSvg } from "../costs/page";

describe("SpendSvg", () => {
  it("shows hovered raw and reduced spend values", () => {
    const points = [
      { t: new Date("2026-05-01T00:00:00Z").getTime(), rawSpendCents: 100, reducedSpendCents: 60 },
      { t: new Date("2026-05-02T00:00:00Z").getTime(), rawSpendCents: 120, reducedSpendCents: 72 },
      { t: new Date("2026-05-03T00:00:00Z").getTime(), rawSpendCents: 140, reducedSpendCents: 84 },
    ];

    const { getByTestId } = render(<SpendSvg points={points} range="7d" />);
    const hitbox = getByTestId("spend-chart-hitbox");
    hitbox.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 760,
      bottom: 260,
      width: 760,
      height: 260,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(hitbox, { clientX: 732, clientY: 120 });

    expect(screen.getByText(/raw spend/i)).toBeInTheDocument();
    expect(screen.getByText(/reduced spend/i)).toBeInTheDocument();
    expect(screen.getByText("$1.40")).toBeInTheDocument();
    expect(screen.getByText("$0.84")).toBeInTheDocument();
  });
});
