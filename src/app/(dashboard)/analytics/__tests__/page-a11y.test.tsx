// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      current: { _sum: { bytesIn: 0, bytesOut: 0, eventsIn: 0, eventsOut: 0 } },
      previous: { _sum: { bytesIn: 0, bytesOut: 0, eventsIn: 0, eventsOut: 0 } },
      timeSeries: [],
      perPipeline: [],
    },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    dashboard: {
      volumeAnalytics: {
        queryOptions: vi.fn(() => ({ queryKey: ["volumeAnalytics"], queryFn: vi.fn() })),
      },
    },
  }),
}));

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: () => ({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/hooks/use-polling-interval", () => ({
  usePollingInterval: () => false,
}));

vi.mock("@/components/analytics/recommendations-panel", () => ({
  RecommendationsPanel: () => null,
}));

vi.mock("../costs/page", () => ({
  CostDashboard: () => null,
}));

import AnalyticsPage from "../page";

describe("AnalyticsPage accessibility", () => {
  it("exposes pressed state on analytics time range chips", () => {
    const { getByRole } = render(
      <TooltipProvider>
        <AnalyticsPage />
      </TooltipProvider>
    );

    expect(getByRole("group", { name: "Analytics time range" })).toBeInTheDocument();
    expect(getByRole("button", { name: "1d" })).toHaveAttribute("aria-pressed", "true");
    expect(getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "false");
  });
});
