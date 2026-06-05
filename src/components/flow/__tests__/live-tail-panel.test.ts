// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const liveTapState = vi.hoisted(() => ({
  events: [
    { id: "evt-1", data: { message: "alpha" } },
    { id: "evt-2", data: { message: "beta" } },
  ],
  isActive: false,
  isStarting: false,
  start: vi.fn(),
  stop: vi.fn(),
  error: null,
}));

vi.mock("@/hooks/use-live-tap", () => ({
  useLiveTap: () => liveTapState,
}));

// The panel now offers a "save capture" affordance backed by tRPC
// (trpc.tapCapture.create), so it calls useTRPC()/useMutation on render. Mock
// both so the panel renders without a real TRPCProvider/QueryClientProvider.
vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    tapCapture: {
      create: { mutationOptions: (opts: unknown) => opts },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: unknown) => ({
    mutate: vi.fn(),
    isPending: false,
    ...((opts as Record<string, unknown>) ?? {}),
  }),
}));

import { LiveTailPanel } from "../live-tail-panel";

afterEach(cleanup);

const liveTailSource = readFileSync("src/components/flow/live-tail-panel.tsx", "utf8");

describe("LiveTailPanel", () => {
  beforeEach(() => {
    liveTapState.events = [
      { id: "evt-1", data: { message: "alpha" } },
      { id: "evt-2", data: { message: "beta" } },
    ];
    liveTapState.isActive = false;
    liveTapState.isStarting = false;
    liveTapState.start.mockReset();
    liveTapState.stop.mockReset();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("uses a wider resizable dock instead of the old fixed box", () => {
    expect(liveTailSource).toContain("left-3 right-3");
    expect(liveTailSource).toContain("max-w-[720px]");
    expect(liveTailSource).toContain("resize-y");
    expect(liveTailSource).not.toContain("w-[360px]");
    expect(liveTailSource).not.toContain("h-[140px]");
  });

  it("supports expansion for smaller screens", () => {
    expect(liveTailSource).toContain("Expand live tail");
    expect(liveTailSource).toContain("Collapse live tail");
    expect(liveTailSource).toContain('expanded ? "h-[320px]" : "h-[180px]"');
  });

  it("wraps log lines by default and lets operators switch to scroll mode", async () => {
    render(React.createElement(LiveTailPanel, { pipelineId: "pipe-1", componentKey: "comp-1", isDeployed: true }));

    const line = await screen.findByText('{"message":"alpha"}');
    expect(line).toHaveClass("whitespace-pre-wrap", "break-all");
    expect(line.parentElement).not.toHaveClass("overflow-x-auto");

    fireEvent.click(screen.getByLabelText(/switch to scroll mode/i));

    expect(await screen.findByText('{"message":"alpha"}')).toHaveClass("whitespace-nowrap");
    expect(line.parentElement).toHaveClass("overflow-x-auto");
  });

  it("copies the visible log buffer to the clipboard", async () => {
    render(React.createElement(LiveTailPanel, { pipelineId: "pipe-1", componentKey: "comp-1", isDeployed: true }));

    fireEvent.click(screen.getByLabelText(/copy live tail/i));

    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(
      '{"message":"alpha"}\n{"message":"beta"}',
    );
  });
});
