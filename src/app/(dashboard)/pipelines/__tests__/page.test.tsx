// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  configurable: true,
});

const pipeline = vi.hoisted(() => ({
  id: "pipe-1",
  name: "metrics-aggregator",
  description: "Aggregates host metrics",
  isDraft: false,
  deployedAt: new Date("2026-05-07T00:00:00Z"),
  createdAt: new Date("2026-05-01T00:00:00Z"),
  updatedAt: new Date("2026-05-08T00:00:00Z"),
  tags: ["prod"],
  groupId: null,
  group: null,
  createdBy: { name: "Creator", email: "creator@example.com", image: null },
  updatedBy: { name: "Updater", email: "updater@example.com", image: null },
  nodeStatuses: [
    {
      status: "RUNNING",
      eventsIn: 100,
      eventsOut: 60,
      errorsTotal: 0,
      eventsDiscarded: 10,
      bytesIn: 2048,
      bytesOut: 1024,
      uptimeSeconds: 3600,
    },
  ],
  hasUndeployedChanges: false,
  hasStaleComponents: false,
  staleComponentNames: [],
  upstreamDepCount: 0,
  downstreamDepCount: 0,
  minUptimeSeconds: 3600,
}));

const filterState = vi.hoisted(() => ({
  search: "",
  statusFilter: [] as string[],
  tagFilter: [] as string[],
  groupId: null as string | null,
  sortBy: "name",
  sortOrder: "asc",
  hasActiveFilters: false,
  setSearch: vi.fn(),
  setStatusFilter: vi.fn(),
  setTagFilter: vi.fn(),
  setGroupId: vi.fn(),
  setSortBy: vi.fn(),
  setSortOrder: vi.fn(),
  clearFilters: vi.fn(),
}));

const sidebarState = vi.hoisted(() => ({
  manageGroupsOpen: false,
  setManageGroupsOpen: vi.fn(),
  selectedGroupId: null as string | null,
  setSelectedGroupId: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: (selector: (state: { selectedEnvironmentId: string }) => unknown) =>
    selector({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/stores/team-store", () => ({
  useTeamStore: (selector: (state: { selectedTeamId: string }) => unknown) =>
    selector({ selectedTeamId: "team-1" }),
}));

vi.mock("@/hooks/use-pipeline-list-filters", () => ({
  usePipelineListFilters: () => filterState,
}));

vi.mock("@/stores/pipeline-sidebar-store", () => ({
  usePipelineSidebarStore: (selector: (state: typeof sidebarState) => unknown) =>
    selector(sidebarState),
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: (options: { __name?: string }) => {
    if (options.__name === "pipeline.list") {
      return {
        data: { pages: [{ pipelines: [pipeline], totalCount: 1 }], pageParams: [] },
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        error: null,
      };
    }
    return {
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    };
  },
  useQuery: (options: { __name?: string }) => {
    switch (options.__name) {
      case "environment.list":
        return { data: [{ id: "env-1", name: "production" }], isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() };
      case "metrics.getLiveRates":
        return { data: { rates: { "pipe-1": { eventsPerSec: 42, bytesPerSec: 512 } } }, isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() };
      case "filterPreset.list":
      case "release.direct.listPendingRequests":
      case "pipelineGroup.list":
        return { data: [], isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() };
      case "pipeline.batchHealth":
        return { data: { "pipe-1": { status: "healthy", slis: [] } }, isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() };
      case "anomaly.countByPipeline":
      case "anomaly.maxSeverityByPipeline":
        return { data: {}, isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() };
      default:
        return { data: undefined, isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() };
    }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    environment: {
      list: { queryOptions: () => ({ __name: "environment.list" }) },
    },
    pipeline: {
      list: { infiniteQueryOptions: () => ({ __name: "pipeline.list" }), queryKey: () => ["pipeline.list"] },
      batchHealth: { queryOptions: () => ({ __name: "pipeline.batchHealth" }) },
      clone: { mutationOptions: (options: unknown) => options },
      delete: { mutationOptions: (options: unknown) => options },
      update: { mutationOptions: (options: unknown) => options },
    },
    metrics: {
      getLiveRates: { queryOptions: () => ({ __name: "metrics.getLiveRates" }) },
    },
    filterPreset: {
      list: { queryOptions: () => ({ __name: "filterPreset.list" }) },
    },
    release: {
      direct: {
        listPendingRequests: { queryOptions: () => ({ __name: "release.direct.listPendingRequests" }) },
      },
    },
    anomaly: {
      countByPipeline: { queryOptions: () => ({ __name: "anomaly.countByPipeline" }) },
      maxSeverityByPipeline: { queryOptions: () => ({ __name: "anomaly.maxSeverityByPipeline" }) },
    },
    pipelineGroup: {
      list: { queryOptions: () => ({ __name: "pipelineGroup.list" }) },
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/pipeline/pipeline-list-toolbar", () => ({
  PipelineListToolbar: () => <div>Toolbar</div>,
}));
vi.mock("@/components/pipeline/manage-groups-dialog", () => ({ ManageGroupsDialog: () => null }));
vi.mock("@/components/pipeline/bulk-action-bar", () => ({ BulkActionBar: () => null }));
vi.mock("@/components/filter-preset/FilterPresetBar", () => ({ FilterPresetBar: () => null }));
vi.mock("@/components/filter-preset/SaveFilterDialog", () => ({ SaveFilterDialog: () => null }));
vi.mock("@/components/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/promote-pipeline-dialog", () => ({ PromotePipelineDialog: () => null }));
vi.mock("@/components/anomaly-badge", () => ({ AnomalyBadge: () => null }));
vi.mock("@/components/ui/sparkline", () => ({ Sparkline: () => <div /> }));
vi.mock("@/components/motion/stagger-list", () => ({
  StaggerList: ({ as: Tag = "div", children, ...props }: { as?: React.ElementType; children: React.ReactNode }) => <Tag {...props}>{children}</Tag>,
  StaggerItem: ({ as: Tag = "div", children, ...props }: { as?: React.ElementType; children: React.ReactNode }) => <Tag {...props}>{children}</Tag>,
}));
vi.mock("@/lib/badge-variants", () => ({ tagBadgeClass: () => "", reductionBadgeClass: () => "" }));
vi.mock("@/lib/format", () => ({ formatEventsRate: () => "42/s", formatBytesRate: () => "512 B/s" }));
vi.mock("@/components/pipeline/pipeline-group-tree", () => ({ buildGroupTree: () => [] }));

import PipelinesPage from "../page";

describe("PipelinesPage responsive columns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("marks created and bytes columns as responsive-only", () => {
    render(<PipelinesPage />);

    const createdHeader = screen.getByText("Created").closest("th");
    const bytesHeader = screen.getByText("Bytes/sec In").closest("th");

    expect(createdHeader?.className).toContain("min-[1281px]:table-cell");
    expect(createdHeader?.className).toContain("hidden");
    expect(bytesHeader?.className).toContain("min-[1100px]:table-cell");
    expect(bytesHeader?.className).toContain("hidden");
  });
});
