// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  writable: true,
  value: vi.fn(),
});

const mockInvalidateQueries = vi.fn();

const queryState = vi.hoisted(() => ({
  promotions: {
    pages: [{ items: [] }],
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
  },
  promotionSummary: {
    PENDING: 0,
    APPROVED: 0,
    DEPLOYED: 0,
    REJECTED: 0,
    CANCELLED: 0,
    AWAITING_PR_MERGE: 0,
    DEPLOYING: 0,
  },
  promotionDiff: { added: [], changed: [], removed: [] },
  environments: [
    {
      id: "env-1",
      name: "production",
      teamId: "team-1",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      gitRepoUrl: "https://github.com/acme/prod",
      _count: { nodes: 2, pipelines: 2, gitSyncJobs: 0 },
      pipelines: [{ deployedAt: new Date("2026-05-02T00:00:00.000Z") }],
    },
    {
      id: "env-2",
      name: "staging",
      teamId: "team-1",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      gitRepoUrl: null,
      _count: { nodes: 1, pipelines: 1, gitSyncJobs: 0 },
      pipelines: [{ deployedAt: new Date("2026-05-04T00:00:00.000Z") }],
    },
  ],
  pipelinesByEnvironment: {
    "env-1": {
      pipelines: [
        { id: "pipe-1", name: "payments-prod", environmentId: "env-1" },
        { id: "pipe-2", name: "nginx-logs", environmentId: "env-1" },
      ],
    },
    "env-2": {
      pipelines: [{ id: "pipe-3", name: "payments-staging", environmentId: "env-2" }],
    },
  } as Record<string, { pipelines: Array<{ id: string; name: string; environmentId: string }> }>,
}));

function flattenPipelines() {
  return Object.entries(queryState.pipelinesByEnvironment)
    .flatMap(([environmentId, result]) =>
      result.pipelines.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        environmentId,
        environmentName:
          queryState.environments.find((environment) => environment.id === environmentId)?.name ?? environmentId,
      })),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/stores/team-store", () => ({
  useTeamStore: (selector: (state: { selectedTeamId: string }) => unknown) =>
    selector({ selectedTeamId: "team-1" }),
}));

vi.mock("@/components/promote-pipeline-dialog", () => ({
  PromotePipelineDialog: ({ open, pipeline }: { open: boolean; pipeline: { id: string; name: string; environmentId: string } }) =>
    open ? (
      <div data-testid="promote-dialog">
        Promote {pipeline.name} from {pipeline.environmentId}
      </div>
    ) : null,
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    release: {
      promotion: {
        recentForTeam: {
          infiniteQueryOptions: (input: { teamId: string }) => ({
            queryKey: ["release.promotion.recentForTeam", input.teamId],
          }),
          queryKey: () => ["release.promotion.recentForTeam"],
        },
        summaryForTeam: {
          queryOptions: (input: { teamId: string }) => ({
            queryKey: ["release.promotion.summaryForTeam", input.teamId],
          }),
          queryKey: (input: { teamId: string }) => ["release.promotion.summaryForTeam", input.teamId],
        },
        diffPreview: {
          queryOptions: (input: { pipelineId: string }) => ({
            queryKey: ["release.promotion.diffPreview", input.pipelineId],
          }),
        },
        reject: {
          mutationOptions: (opts: unknown) => opts,
        },
        approve: {
          mutationOptions: (opts: unknown) => opts,
        },
      },
    },
    environment: {
      list: {
        queryOptions: (input: { teamId: string }) => ({
          queryKey: ["environment.list", input.teamId],
        }),
      },
    },
    pipeline: {
      list: {
        queryOptions: (input: { environmentId: string }) => ({
          queryKey: ["pipeline.list", input.environmentId],
        }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => queryState.promotions,
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options.queryKey?.[0];
    if (key === "release.promotion.summaryForTeam") {
      return { data: queryState.promotionSummary, isPending: false, isError: false, isSuccess: true, error: null };
    }
    if (key === "release.promotion.diffPreview") {
      return { data: queryState.promotionDiff, isPending: false, isError: false, isSuccess: true, error: null };
    }
    if (key === "environment.list") {
      return {
        data: queryState.environments,
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (key === "promotion-pipeline-picker") {
      return {
        data: flattenPipelines(),
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
      };
    }
    return { data: undefined, isLoading: false, isPending: false, isError: false, isSuccess: true, error: null };
  },
  useQueries: () => [],
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    fetchQuery: vi.fn(async (options: { queryKey?: unknown[] }) => {
      const input = options.queryKey?.[2] as { environmentId?: string } | undefined;
      const environmentId = input?.environmentId;
      return environmentId ? queryState.pipelinesByEnvironment[environmentId] ?? { pipelines: [] } : { pipelines: [] };
    }),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import PromotionsPage from "@/app/(dashboard)/promotions/page";
import EnvironmentsPage from "@/app/(dashboard)/environments/page";

describe("promotion entrypoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a pipeline picker from the promotions page and launches the promotion dialog", async () => {
    render(<PromotionsPage />);

    fireEvent.click(screen.getByRole("button", { name: /new promotion/i }));

    expect(screen.getByPlaceholderText(/search pipelines/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("payments-prod"));

    expect(await screen.findByTestId("promote-dialog")).toHaveTextContent(
      "Promote payments-prod from env-1",
    );
  });

  it("opens the same promotion flow from the environments page", async () => {
    render(<EnvironmentsPage />);

    fireEvent.click(screen.getByRole("button", { name: /promote pipeline/i }));

    const picker = screen.getByRole("dialog", { name: /select pipeline/i });
    expect(within(picker).getByPlaceholderText(/search pipelines/i)).toBeInTheDocument();

    fireEvent.click(within(picker).getByText("payments-staging"));

    expect(await screen.findByTestId("promote-dialog")).toHaveTextContent(
      "Promote payments-staging from env-2",
    );
  });
});
