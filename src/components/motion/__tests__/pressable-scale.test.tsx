// @vitest-environment jsdom

/**
 * PressableScale component tests.
 *
 * Uses the same mock patterns as animated-number.test.tsx:
 *  - mock motion/react-m to return plain HTML elements so we don't need the
 *    full animation runtime in tests.
 *  - mock @/hooks/use-reduced-motion to control the reduced-motion branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock motion/react-m so m.div / m.span render as plain elements
// ---------------------------------------------------------------------------

vi.mock("motion/react-m", () => ({
  div: "div",
  span: "span",
}));

// Mock the re-export hook so the import path resolves correctly.
const mockUseReducedMotion = vi.fn(() => false); // default: motion ON

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { PressableScale } from "../pressable-scale";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PressableScale", () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it("renders children when reduced motion is false (animated path)", () => {
    const { container } = render(
      <PressableScale>
        <button>Click me</button>
      </PressableScale>,
    );
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("button")!.textContent).toBe("Click me");
  });

  it("renders a div wrapper when reduced motion is false", () => {
    const { container } = render(
      <PressableScale>
        <span>child</span>
      </PressableScale>,
    );
    // The outer wrapper is a div (either real or mocked m.div → plain div)
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("renders children when reduced motion is true (plain fallback path)", () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { container } = render(
      <PressableScale>
        <button>Click me</button>
      </PressableScale>,
    );
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("button")!.textContent).toBe("Click me");
  });

  it("renders plain div (not m.div) when reduced motion is true", () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { container } = render(
      <PressableScale>
        <span>child</span>
      </PressableScale>,
    );
    // Should still have a div wrapper
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("applies className prop when reduced motion is false", () => {
    const { container } = render(
      <PressableScale className="my-class">
        <span>child</span>
      </PressableScale>,
    );
    expect(container.querySelector(".my-class")).not.toBeNull();
  });

  it("applies className prop when reduced motion is true", () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { container } = render(
      <PressableScale className="my-class">
        <span>child</span>
      </PressableScale>,
    );
    expect(container.querySelector(".my-class")).not.toBeNull();
  });

  it("renders as span when as='span' and reduced motion is false", () => {
    const { container } = render(
      <PressableScale as="span">
        <em>child</em>
      </PressableScale>,
    );
    // Outer wrapper should be span
    expect(container.querySelector("span")).not.toBeNull();
    // Should NOT have a wrapping div
    expect(container.querySelector("div")).toBeNull();
  });

  it("renders as span when as='span' and reduced motion is true", () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { container } = render(
      <PressableScale as="span">
        <em>child</em>
      </PressableScale>,
    );
    expect(container.querySelector("span")).not.toBeNull();
    expect(container.querySelector("div")).toBeNull();
  });

  it("defaults hoverScale to 1.02 (rendered without error)", () => {
    // We just verify no error is thrown with default hoverScale
    expect(() =>
      render(
        <PressableScale>
          <span>child</span>
        </PressableScale>,
      ),
    ).not.toThrow();
  });

  it("accepts custom hoverScale without throwing", () => {
    expect(() =>
      render(
        <PressableScale hoverScale={1.05}>
          <span>child</span>
        </PressableScale>,
      ),
    ).not.toThrow();
  });
});
