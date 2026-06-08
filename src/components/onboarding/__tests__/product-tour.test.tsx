/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ProductTour, startProductTour, type TourStep } from "../product-tour";

const DISMISS_KEY = "vf:tour-dismissed";

const STEPS: TourStep[] = [
  { title: "Pipelines step", body: "Build pipelines here.", targetSelector: '[data-tour="pipelines"]' },
  { title: "Fleet step", body: "Manage your fleet.", targetSelector: '[data-tour="fleet"]' },
  { title: "Ghost step", body: "This target is absent.", targetSelector: '[data-tour="does-not-exist"]' },
];

/** Mount two of the three step targets so the tour can anchor (and auto-start). */
function mountTargets() {
  for (const key of ["pipelines", "fleet"]) {
    const el = document.createElement("a");
    el.setAttribute("data-tour", key);
    el.setAttribute("href", `/${key}`);
    document.body.appendChild(el);
  }
}

describe("ProductTour", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mountTargets();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("auto-starts on first run and renders step one's title and body", () => {
    render(<ProductTour steps={STEPS} />);
    expect(screen.getByText("Pipelines step")).toBeDefined();
    expect(screen.getByText("Build pipelines here.")).toBeDefined();
    // SR-only progress counter reflects the current step.
    expect(screen.getByText("Step 1 of 3")).toBeDefined();
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("Next advances to the following step and Back returns", () => {
    render(<ProductTour steps={STEPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Fleet step")).toBeDefined();
    expect(screen.queryByText("Pipelines step")).toBeNull();
    expect(screen.getByText("Step 2 of 3")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Pipelines step")).toBeDefined();
    expect(screen.getByText("Step 1 of 3")).toBeDefined();
  });

  it("Skip persists the dismissal flag and unmounts the tour", () => {
    const { container } = render(<ProductTour steps={STEPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("Finish on the last step persists the flag and unmounts", () => {
    const { container } = render(<ProductTour steps={STEPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // → step 2
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // → step 3 (last)
    expect(screen.getByText("Ghost step")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("Escape dismisses the tour and persists the flag", () => {
    const { container } = render(<ProductTour steps={STEPS} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("does not auto-start once dismissed, but startProductTour reopens it", () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    const { container } = render(<ProductTour steps={STEPS} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Explicit restart clears the one-time flag and reopens at step one.
    act(() => startProductTour());
    expect(screen.getByText("Pipelines step")).toBeDefined();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBeNull();
  });

  it("renders safely when a step's target selector matches nothing", () => {
    render(<ProductTour steps={STEPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The ghost step's target is absent — the card still renders (anchored
    // safely) rather than crashing or vanishing.
    expect(screen.getByText("Ghost step")).toBeDefined();
    expect(screen.getByText("This target is absent.")).toBeDefined();
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("never auto-starts when none of the step targets exist on the page", () => {
    document.body.innerHTML = ""; // remove the mounted targets
    const { container } = render(<ProductTour steps={STEPS} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
