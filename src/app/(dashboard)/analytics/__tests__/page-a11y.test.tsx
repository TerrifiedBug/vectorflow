// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const environmentStoreState = vi.hoisted(() => ({
  selectedEnvironmentId: "env-1" as string | null,
}));

afterEach(() => {
  environmentStoreState.selectedEnvironmentId = "env-1";
  cleanup();
});

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
    analytics: {
      costSummary: {
        queryOptions: vi.fn(() => ({ queryKey: ["costSummary"], queryFn: vi.fn() })),
      },
      costByPipeline: {
        queryOptions: vi.fn(() => ({ queryKey: ["costByPipeline"], queryFn: vi.fn() })),
      },
      costTimeSeries: {
        queryOptions: vi.fn(() => ({ queryKey: ["costTimeSeries"], queryFn: vi.fn() })),
      },
      costByTeam: {
        queryOptions: vi.fn(() => ({ queryKey: ["costByTeam"], queryFn: vi.fn() })),
      },
      costByEnvironment: {
        queryOptions: vi.fn(() => ({ queryKey: ["costByEnvironment"], queryFn: vi.fn() })),
      },
    },
    lake: {
      status: {
        queryOptions: vi.fn(() => ({ queryKey: ["lakeStatus"], queryFn: vi.fn() })),
      },
    },
  }),
}));

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: () => ({ selectedEnvironmentId: environmentStoreState.selectedEnvironmentId }),
}));

vi.mock("@/hooks/use-polling-interval", () => ({
  usePollingInterval: () => false,
}));

vi.mock("@/components/analytics/recommendations-panel", () => ({
  RecommendationsPanel: () => null,
}));


import AnalyticsPage from "../page";
import { CostDashboard } from "../costs/page";

const analyticsPageSource = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
const costPageSource = readFileSync(join(__dirname, "..", "costs", "page.tsx"), "utf8");
const deploymentPageSource = readFileSync(
  join(__dirname, "..", "..", "audit", "deployments", "page.tsx"),
  "utf8"
);

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

  it("keeps cost analytics reachable from the analytics page", () => {
    const { getByRole } = render(
      <TooltipProvider>
        <AnalyticsPage />
      </TooltipProvider>
    );

    expect(getByRole("link", { name: "Costs" })).toHaveAttribute("href", "/analytics/costs");
  });

  it("keeps cost analytics reachable before an environment is selected", () => {
    environmentStoreState.selectedEnvironmentId = null;

    const { getByRole } = render(
      <TooltipProvider>
        <AnalyticsPage />
      </TooltipProvider>
    );

    expect(getByRole("link", { name: "Costs" })).toHaveAttribute("href", "/analytics/costs");
    expect(getByRole("heading", { name: "Select an environment to view analytics" })).toBeInTheDocument();
  });

  it("keeps volume analytics reachable from cost empty states", () => {
    environmentStoreState.selectedEnvironmentId = null;

    const { getByRole } = render(
      <TooltipProvider>
        <CostDashboard />
      </TooltipProvider>
    );

    expect(getByRole("link", { name: "Volume" })).toHaveAttribute("href", "/analytics");
    expect(getByRole("link", { name: "Costs" })).toHaveAttribute("href", "/analytics/costs");
    expect(getByRole("heading", { name: "Select an environment to view cost analytics" })).toBeInTheDocument();
  });
});

describe("first-class analytics and audit routes", () => {
  it("keeps cost analytics as a first-class route while linking to it from analytics", () => {
    expect(analyticsPageSource).not.toContain("CostDashboard");
    expect(analyticsPageSource).toContain('href="/analytics/costs"');
  });

  it("renders cost analytics directly instead of redirecting through analytics query params", () => {
    expect(costPageSource).not.toContain("router.replace");
    expect(costPageSource).not.toContain("/analytics?tab=costs");
    expect(costPageSource).toContain("export default function CostDashboardPage()");
    expect(costPageSource).toContain("<CostDashboard />");
    expect(costPageSource).toContain('href="/analytics"');
  });

  it("renders deployment history directly instead of redirecting through audit query params", () => {
    expect(deploymentPageSource).not.toContain("router.replace");
    expect(deploymentPageSource).not.toContain("/audit?tab=deployments");
    expect(deploymentPageSource).toContain("export default function DeploymentHistoryPage()");
    expect(deploymentPageSource).toContain("<DeploymentHistory />");
  });
});
