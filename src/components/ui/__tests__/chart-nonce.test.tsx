// @vitest-environment jsdom

/**
 * VF-21: the chart's inline <style> must carry the per-request CSP nonce so it
 * is permitted under the strict multi-tenant CSP (which drops 'unsafe-inline').
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

// ResponsiveContainer needs a sized parent in jsdom; stub recharts to keep the
// test focused on ChartStyle's <style> emission.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc">{children}</div>
  ),
}));

import { ChartContainer } from "@/components/ui/chart";
import { NonceProvider } from "@/components/nonce-provider";

const config = { cpu: { label: "CPU", color: "#ff0000" } };

afterEach(() => cleanup());

describe("ChartStyle nonce threading (VF-21)", () => {
  it("attaches the provided nonce to the inline <style>", () => {
    const { container } = render(
      <NonceProvider nonce="test-nonce-123">
        <ChartContainer config={config}>
          <div>child</div>
        </ChartContainer>
      </NonceProvider>,
    );

    const style = container.querySelector("style");
    expect(style).not.toBeNull();
    expect(style?.getAttribute("nonce")).toBe("test-nonce-123");
    // Sanity: the dynamic CSS variable is still emitted.
    expect(style?.innerHTML).toContain("--color-cpu");
  });

  it("omits the nonce attribute when none is provided (OSS/non-strict mode)", () => {
    const { container } = render(
      <NonceProvider nonce="">
        <ChartContainer config={config}>
          <div>child</div>
        </ChartContainer>
      </NonceProvider>,
    );

    const style = container.querySelector("style");
    expect(style).not.toBeNull();
    // Empty nonce → undefined → no attribute rendered.
    expect(style?.hasAttribute("nonce")).toBe(false);
  });
});
