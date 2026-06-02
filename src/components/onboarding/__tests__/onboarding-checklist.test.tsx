/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OnboardingChecklist } from "../onboarding-checklist";

// next/link needs no App Router context for these static hrefs; render a bare anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

describe("OnboardingChecklist", () => {
  beforeEach(() => {
    if (!window.localStorage) {
      const store = new Map<string, string>();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, String(v)),
          removeItem: (k: string) => void store.delete(k),
          clear: () => store.clear(),
        },
      });
    }
    window.localStorage.clear();
  });

  afterEach(() => cleanup());

  it("shows the agent step as current for a brand-new tenant (env step already done)", () => {
    render(
      <OnboardingChecklist
        variant="full"
        environmentId="env-1"
        agentEnrolled={false}
        pipelineCreated={false}
        pipelineDeployed={false}
      />,
    );
    expect(screen.getByText("Get started with VectorFlow")).toBeDefined();
    // environment step is intrinsically complete → 1 of 4.
    expect(screen.getByText("1 of 4 steps complete")).toBeDefined();
    const cta = screen.getByRole("link", { name: "Get enrollment token" });
    expect(cta.getAttribute("href")).toBe("/environments/env-1?tab=enrollment");
  });

  it("advances the current step + CTA as prerequisites complete", () => {
    render(
      <OnboardingChecklist
        environmentId="env-1"
        agentEnrolled
        pipelineCreated={false}
        pipelineDeployed={false}
      />,
    );
    expect(screen.getByText("2 of 4 steps complete")).toBeDefined();
    const cta = screen.getByRole("link", { name: "Create pipeline" });
    expect(cta.getAttribute("href")).toBe("/pipelines/new");
    // The enrollment CTA is no longer the current action.
    expect(screen.queryByRole("link", { name: "Get enrollment token" })).toBeNull();
  });

  it("renders nothing once every step is complete", () => {
    const { container } = render(
      <OnboardingChecklist
        environmentId="env-1"
        agentEnrolled
        pipelineCreated
        pipelineDeployed
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("banner variant can be dismissed and stays hidden", () => {
    const props = {
      environmentId: "env-1",
      agentEnrolled: true,
      pipelineCreated: false,
      pipelineDeployed: false,
    } as const;
    const { unmount } = render(<OnboardingChecklist {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss getting-started checklist" }));
    expect(screen.queryByText("Get started with VectorFlow")).toBeNull();
    expect(window.localStorage.getItem("vf:onboarding-dismissed")).toBe("1");
    unmount();

    // A fresh mount honours the persisted dismissal.
    render(<OnboardingChecklist {...props} />);
    expect(screen.queryByText("Get started with VectorFlow")).toBeNull();
  });

  it("full variant is NOT dismissible (no dismiss control)", () => {
    render(
      <OnboardingChecklist
        variant="full"
        environmentId="env-1"
        agentEnrolled={false}
        pipelineCreated={false}
        pipelineDeployed={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Dismiss getting-started checklist" })).toBeNull();
  });
});
