// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type TimelineSignal = {
  kind: "alert" | "anomaly";
  id: string;
  timestamp: Date;
  firedAt?: Date;
  detectedAt?: Date;
  status?: string;
  alertRule?: { name: string; metric: string; pipeline?: { id: string; name: string } | null };
  pipeline?: { id: string; name: string } | null;
  description?: string | null;
  anomalyType?: string | null;
};

type CorrelationGroup = {
  id: string;
  status: "firing" | "resolved" | "acknowledged";
  title: string | null;
  environmentId: string;
  openedAt: Date;
  resolvedAt: Date | null;
  alertCount: number;
  anomalyCount: number;
  signalCount: number;
  events: TimelineSignal[];
  anomalyEvents: TimelineSignal[];
  timeline: TimelineSignal[];
};

type QueryState = {
  data: { items: CorrelationGroup[]; nextCursor?: string } | undefined;
  isError: boolean;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
};

const queryState = vi.hoisted((): { value: QueryState } => ({
  value: {
    data: { items: [] },
    isError: false,
    isPending: false,
    isSuccess: true,
    error: null,
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.value,
  useInfiniteQuery: () => ({
    ...queryState.value,
    data: queryState.value.data ? { pages: [queryState.value.data] } : undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useQueries: () => [],
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    alert: {
      listCorrelationGroups: {
        infiniteQueryOptions: vi.fn(() => ({ queryKey: ["correlation-groups"], queryFn: vi.fn() })),
      },
      getCorrelationGroup: {
        queryOptions: vi.fn(() => ({ queryKey: ["correlation-group"], queryFn: vi.fn() })),
      },
    },
    audit: {
      deployments: {
        infiniteQueryOptions: vi.fn(() => ({ queryKey: ["deployments"], queryFn: vi.fn() })),
      },
    },
    dashboard: {
      pipelineCards: {
        queryOptions: vi.fn(() => ({ queryKey: ["pipeline-cards"], queryFn: vi.fn() })),
      },
    },
  }),
}));

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: () => ({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/components/ui/date-range-picker", () => ({
  DateRangePicker: () => <button type="button">Incident window</button>,
}));

import IncidentsPage from "../page";

describe("IncidentsPage", () => {
  afterEach(() => {
    cleanup();
    queryState.value = {
      data: { items: [] },
      isError: false,
      isPending: false,
      isSuccess: true,
      error: null,
    };
  });

  it("renders correlated incident copy instead of anomaly-only copy", () => {
    render(<IncidentsPage />);

    expect(screen.getByRole("heading", { name: /incident timeline/i })).toBeInTheDocument();
    expect(screen.getByText(/correlated alert, anomaly, deploy, and rollback signals/i)).toBeInTheDocument();
    expect(screen.queryByText(/anomaly data only/i)).not.toBeInTheDocument();
  });

  it("counts alert and anomaly signals from correlation groups", async () => {
    const now = new Date();
    queryState.value = {
      data: {
        items: [
          {
            id: "group-1",
            status: "firing",
            title: "k8s.events incident",
            environmentId: "env-1",
            openedAt: now,
            resolvedAt: null,
            alertCount: 2,
            anomalyCount: 1,
            signalCount: 3,
            events: [],
            anomalyEvents: [],
            timeline: [
              {
                kind: "alert",
                id: "alert-1",
                timestamp: now,
                firedAt: now,
                status: "firing",
                alertRule: { name: "High CPU", metric: "cpu", pipeline: { id: "pipe-1", name: "k8s.events" } },
              },
              {
                kind: "anomaly",
                id: "anom-1",
                timestamp: now,
                detectedAt: now,
                pipeline: { id: "pipe-1", name: "k8s.events" },
                anomalyType: "latency_spike",
              },
            ],
          },
        ],
      },
      isError: false,
      isPending: false,
      isSuccess: true,
      error: null,
    };

    render(<IncidentsPage />);

    const activeKpi = screen.getByText("ACTIVE INCIDENTS").parentElement;
    expect(activeKpi).not.toBeNull();
    expect(await within(activeKpi!).findByText("1")).toBeInTheDocument();

    const signalsKpi = screen.getByText("SIGNALS · 14H").parentElement;
    expect(signalsKpi).not.toBeNull();
    expect(within(signalsKpi!).getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText(/1 alerts · 1 anomalies/i).length).toBeGreaterThan(0);
  });
});
