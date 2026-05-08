// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const capturedMetricRequests = vi.hoisted((): Array<{ pipelineId: string; minutes: number }> => []);

const pipeline = vi.hoisted(() => ({
  id: "pipe-qa",
  name: "QA ingest pipeline",
  description: "Production ingest path",
  isDraft: false,
  deployedAt: new Date("2026-05-08T00:00:00Z"),
  updatedAt: new Date("2026-05-08T00:10:00Z"),
  createdAt: new Date("2026-05-07T00:00:00Z"),
  isSystem: false,
  hasConfigChanges: true,
  deployedVersionNumber: 7,
  gitOpsMode: "manual",
  gitPath: "pipelines/qa.yaml",
  enrichMetadata: true,
  autoRollbackEnabled: true,
  autoRollbackThreshold: 5,
  autoRollbackWindowMinutes: 10,
  globalConfig: { log_level: "info" },
  environment: { name: "prod", gitOpsMode: "manual", teamId: "team-1" },
  tags: ["critical"],
  nodes: [
    {
      id: "node-source",
      componentKey: "source-0",
      displayName: "Ingress",
      componentType: "demo_logs",
      kind: "SOURCE",
      config: { endpoint: "/logs" },
      positionX: 0,
      positionY: 0,
      disabled: false,
      sharedComponentId: null,
      sharedComponentVersion: null,
      sharedComponent: null,
    },
    {
      id: "node-sink",
      componentKey: "sink-0",
      displayName: "Archive",
      componentType: "blackhole",
      kind: "SINK",
      config: {},
      positionX: 220,
      positionY: 0,
      disabled: false,
      sharedComponentId: "shared-1",
      sharedComponentVersion: 3,
      sharedComponent: { name: "Archive sink", version: 4 },
    },
  ],
  edges: [{ id: "edge-1", sourceNodeId: "node-source", targetNodeId: "node-sink", sourcePort: "logs" }],
  nodeStatuses: [
    { status: "RUNNING", uptimeSeconds: 120 },
    { status: "RUNNING", uptimeSeconds: 90 },
  ],
  versions: [{ configYaml: "sources: {}", logLevel: "info", version: 7 }],
}));

const versions = vi.hoisted(() => [
  {
    id: "version-7",
    pipelineId: "pipe-qa",
    version: 7,
    changelog: "Promoted QA seed pipeline",
    createdById: "user-1",
    createdAt: new Date("2026-05-08T00:00:00Z"),
    createdBy: { name: "Ops", email: "ops@example.com" },
  },
]);

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "pipe-qa" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { __name?: string }) => {
    switch (options.__name) {
      case "pipeline.get":
        return { data: pipeline, isLoading: false, isError: false, error: null, dataUpdatedAt: Date.now(), refetch: vi.fn() };
      case "pipeline.versionsSummary":
        return { data: versions, isLoading: false, isError: false, error: null, refetch: vi.fn() };
      case "pipelineDependency.list":
        return { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
      case "pipelineDependency.deploymentImpact":
        return { data: { total: 2, deployed: [{ id: "down-1" }], draft: [{ id: "down-2" }] }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
      case "metrics.getPipelineMetrics":
        return { data: { rows: [{ timestamp: new Date(), eventsIn: BigInt(10), eventsOut: BigInt(9), eventsDiscarded: BigInt(1), errorsTotal: BigInt(0), bytesIn: BigInt(100), bytesOut: BigInt(90), utilization: 0.4, latencyMeanMs: 7 }] }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
      case "metrics.getComponentLatencyHistory":
        return { data: { components: {} }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
      case "metrics.getComponentMetrics":
      case "pipeline.logs":
      case "team.get":
      case "promotion.history":
      case "pipelineDependency.undeployWarnings":
        return { data: options.__name === "team.get" ? { aiEnabled: false } : undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
      default:
        return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    pipelineDependency: {
      list: { queryOptions: (input: { pipelineId: string }) => ({ __name: "pipelineDependency.list", input }) },
      deploymentImpact: { queryOptions: (input: { pipelineId: string }) => ({ __name: "pipelineDependency.deploymentImpact", input }) },
      undeployWarnings: { queryOptions: (input: { pipelineId: string }) => ({ __name: "pipelineDependency.undeployWarnings", input }) },
    },
    metrics: {
      getPipelineMetrics: {
        queryOptions: (input: { pipelineId: string; minutes: number }) => {
          capturedMetricRequests.push(input);
          return { __name: "metrics.getPipelineMetrics", input };
        },
      },
      getComponentLatencyHistory: { queryOptions: (input: { pipelineId: string; minutes: number }) => ({ __name: "metrics.getComponentLatencyHistory", input }) },
      getComponentMetrics: { queryOptions: (input: { pipelineId: string; minutes: number }) => ({ __name: "metrics.getComponentMetrics", input }) },
    },
    pipeline: {
      get: { queryOptions: (input: { id: string }) => ({ __name: "pipeline.get", input }), queryKey: (input?: unknown) => ["pipeline.get", input] },
      versionsSummary: { queryOptions: (input: { pipelineId: string }) => ({ __name: "pipeline.versionsSummary", input }) },
      logs: { queryOptions: (input: { pipelineId: string }) => ({ __name: "pipeline.logs", input }) },
      saveGraph: { mutationOptions: (options: unknown) => options },
      discardChanges: { mutationOptions: (options: unknown) => options },
      delete: { mutationOptions: (options: unknown) => options },
      update: { mutationOptions: (options: unknown) => options },
    },
    deploy: { undeploy: { mutationOptions: (options: unknown) => options } },
    team: { get: { queryOptions: (input: { id: string }) => ({ __name: "team.get", input }) } },
    promotion: { history: { queryOptions: (input: { pipelineId: string }) => ({ __name: "promotion.history", input }) } },
  }),
}));

vi.mock("@xyflow/react", () => ({ ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/stores/team-store", () => ({ useTeamStore: () => "team-1" }));
vi.mock("@/stores/flow-store", () => {
  const store = {
    loadGraph: vi.fn(),
    isDirty: true,
    markClean: vi.fn(),
    updateNodeMetrics: vi.fn(),
    nodes: pipeline.nodes.map((node) => ({ id: node.id, type: node.kind.toLowerCase(), position: { x: node.positionX, y: node.positionY }, data: { componentKey: node.componentKey, componentDef: { type: node.componentType, configSchema: {} }, config: node.config } })),
    edges: [{ id: "edge-1", source: "node-source", target: "node-sink" }],
    selectedNodeId: null,
    globalConfig: pipeline.globalConfig,
  };
  const useFlowStore = (selector: (state: typeof store) => unknown) => selector(store);
  useFlowStore.getState = () => store;
  return { useFlowStore };
});
vi.mock("@/hooks/use-flow-metrics", () => ({ useFlowMetrics: vi.fn() }));
vi.mock("@/hooks/use-polling-interval", () => ({ usePollingInterval: () => false }));
vi.mock("@/lib/config-generator", () => ({ generateVectorYaml: () => "sources: {}" }));
vi.mock("@/lib/vector/catalog", () => ({ findComponentDef: () => ({ type: "demo", kind: "source", displayName: "Demo", description: "", category: "", outputTypes: [], configSchema: {} }) }));
vi.mock("@/lib/vector/validate-node-config", () => ({ validateNodeConfig: () => ({ hasError: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/flow/component-palette", () => ({ ComponentPalette: () => <aside>Palette</aside> }));
vi.mock("@/components/flow/flow-canvas", () => ({ FlowCanvas: () => <main>Canvas</main> }));
vi.mock("@/components/flow/flow-toolbar", () => ({ FlowToolbar: () => <div>Toolbar</div> }));
vi.mock("@/components/flow/ai-pipeline-dialog", () => ({ AiPipelineDialog: () => null }));
vi.mock("@/components/flow/detail-panel", () => ({ DetailPanel: () => <aside>Details</aside> }));
vi.mock("@/components/flow/live-tail-panel", () => ({ LiveTailPanel: () => null }));
vi.mock("@/components/flow/deploy-dialog", () => ({ DeployDialog: () => null }));
vi.mock("@/components/flow/save-template-dialog", () => ({ SaveTemplateDialog: () => null }));
vi.mock("@/components/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/pipeline/metrics-chart", () => ({ PipelineMetricsChart: () => <div>Editor metrics</div> }));
vi.mock("@/components/pipeline/pipeline-logs", () => ({ PipelineLogs: () => <div>Logs</div> }));
vi.mock("@/components/metrics/summary-cards", () => ({ SummaryCards: () => <div>Summary cards</div> }));
vi.mock("@/components/metrics/component-chart", () => ({ MetricsChart: () => <div>Metrics chart</div> }));
vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
}));
vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

import PipelineDetailPage from "../page";
import PipelineBuilderPage from "../edit/editor-client";
import PipelineMetricsPage from "../metrics/page";

describe("pipeline operational pages", () => {
  afterEach(() => {
    cleanup();
    capturedMetricRequests.length = 0;
  });

  it("promotes pipeline detail from manifest summary to operational surface", () => {
    render(<PipelineDetailPage />);

    expect(screen.getByText(/Operational activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Attached runtime/i)).toBeInTheDocument();
    expect(screen.getByText(/Dependency impact/i)).toBeInTheDocument();
    expect(screen.getByText(/Value delivery/i)).toBeInTheDocument();
  });

  it("shows deployed versus draft banner when the editor has pending changes", () => {
    render(<PipelineBuilderPage />);

    expect(screen.getByText(/Unsaved draft/i)).toBeInTheDocument();
    expect(screen.getByText(/deployed v7/i)).toBeInTheDocument();
  });

  it("defaults metrics to the seeded QA data window", () => {
    render(<PipelineMetricsPage />);

    expect(capturedMetricRequests[0]).toMatchObject({ pipelineId: "pipe-qa", minutes: 1440 });
    expect(screen.queryByText(/No metrics data available yet/i)).not.toBeInTheDocument();
  });
});
