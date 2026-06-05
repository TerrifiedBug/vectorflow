// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const unreachableNode = vi.hoisted(() => ({
  id: "node-1",
  name: "prod-node",
  host: "server",
  apiPort: 8686,
  status: "UNREACHABLE",
  lastHeartbeat: new Date("2026-05-09T10:00:00Z"),
  lastSeen: new Date("2026-05-09T10:00:00Z"),
  currentStatusSince: new Date("2026-05-09T10:00:00Z"),
  vectorVersion: "0.51.0",
  agentVersion: "0.1.0",
  runningUser: "root",
  maintenanceMode: false,
  nodeTokenHash: "token-hash",
  labels: {},
  environment: { id: "env-1", name: "Production" },
  pipelineStatuses: [
    {
      id: "status-1",
      pipelineId: "pipe-1",
      status: "RUNNING",
      eventsIn: BigInt(0),
      eventsOut: BigInt(0),
      errorsTotal: BigInt(0),
      uptimeSeconds: 120,
      pipeline: { id: "pipe-1", name: "Docker logs" },
    },
  ],
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ nodeId: "node-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { __name?: string }) => {
    switch (options.__name) {
      case "fleet.get":
        return { data: unreachableNode, isLoading: false, isError: false, refetch: vi.fn() };
      case "metrics.getNodePipelineRates":
        return { data: { rates: {} }, isLoading: false, isError: false, refetch: vi.fn() };
      default:
        return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    fleet: {
      get: { queryOptions: (input: { id: string }, options?: unknown) => ({ __name: "fleet.get", input, options }), queryKey: (input?: unknown) => ["fleet.get", input] },
      list: { queryKey: () => ["fleet.list"] },
      listWithPipelineStatus: { queryKey: () => ["fleet.listWithPipelineStatus"] },
      delete: { mutationOptions: (options: unknown) => options },
      revokeNode: { mutationOptions: (options: unknown) => options },
      setMaintenanceMode: { mutationOptions: (options: unknown) => options },
      updateLabels: { mutationOptions: (options: unknown) => options },
    },
    metrics: {
      getNodePipelineRates: { queryOptions: (input: { nodeId: string }, options?: unknown) => ({ __name: "metrics.getNodePipelineRates", input, options }) },
    },
    lake: {
      status: { queryOptions: () => ({}) },
      listDatasets: { queryOptions: () => ({}) },
    },
  }),
}));

vi.mock("@/stores/team-store", () => ({
  useTeamStore: (selector: (s: { selectedTeamId: string | null }) => unknown) =>
    selector({ selectedTeamId: null }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-polling-interval", () => ({ usePollingInterval: () => false }));
vi.mock("@/components/fleet/node-logs", () => ({ NodeLogs: () => <div>Node logs</div> }));
vi.mock("@/components/fleet/node-metrics-charts", () => ({ NodeMetricsCharts: () => <div>Metrics charts</div> }));
vi.mock("@/components/fleet/uptime-cards", () => ({ UptimeCards: () => <div>Uptime cards</div> }));
vi.mock("@/components/fleet/status-timeline", () => ({ StatusTimeline: () => <div>Status timeline</div> }));
vi.mock("@/components/fleet/event-log", () => ({ EventLog: () => <div>Event log</div> }));
vi.mock("@/components/confirm-dialog", () => ({ ConfirmDialog: () => null }));

import NodeDetailPage from "../page";

describe("fleet node detail", () => {
  afterEach(() => cleanup());

  it("does not offer retry connection for unreachable agents", () => {
    render(<NodeDetailPage />);

    expect(screen.getByText("prod-node disconnected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry connection/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /maintenance/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /delete node/i }).length).toBeGreaterThan(0);
  });

  it("renders resource metrics once outside the tab set", () => {
    render(<NodeDetailPage />);

    expect(screen.getAllByText("Metrics charts")).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Metrics" })).not.toBeInTheDocument();
  });
});
