// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Node } from "@xyflow/react";
import type { FlowState } from "@/stores/flow-store";

afterEach(cleanup);

// ── Store mock ─────────────────────────────────────────────────────────────

const mockToggleDetailPanel = vi.fn();
const mockRemoveNode = vi.fn();
const mockUpdateNodeConfig = vi.fn();
const mockUpdateDisplayName = vi.fn();
const mockToggleNodeDisabled = vi.fn();
const mockCopySelectedNodes = vi.fn();

const baseFlowStore: Partial<FlowState> = {
  selectedNodeId: null,
  selectedNodeIds: new Set(),
  nodes: [],
  edges: [],
  updateNodeConfig: mockUpdateNodeConfig,
  updateDisplayName: mockUpdateDisplayName,
  toggleNodeDisabled: mockToggleNodeDisabled,
  removeNode: mockRemoveNode,
  copySelectedNodes: mockCopySelectedNodes,
  acceptNodeSharedUpdate: vi.fn(),
  unlinkNode: vi.fn(),
  detailPanelCollapsed: false,
  toggleDetailPanel: mockToggleDetailPanel,
};

let currentStore = { ...baseFlowStore };

vi.mock("@/stores/flow-store", () => ({
  useFlowStore: (selector: (s: typeof currentStore) => unknown) =>
    selector(currentStore),
}));

// ── Other mocks ────────────────────────────────────────────────────────────

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    sharedComponent: {
      acceptUpdate: { mutationOptions: vi.fn((opts) => opts) },
      unlink: { mutationOptions: vi.fn((opts) => opts) },
    },
    pipeline: {
      get: { queryKey: vi.fn(() => ["pipeline", "get"]) },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: unknown) => ({ mutate: vi.fn(), isPending: false, ...(opts as object) }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/config-forms/schema-form", () => ({
  SchemaForm: () => <div data-testid="schema-form" />,
}));

vi.mock("@/components/vrl-editor/vrl-editor", () => ({
  VrlEditor: () => <div data-testid="vrl-editor" />,
}));

vi.mock("@/components/flow/live-tail-panel", () => ({
  LiveTailPanel: () => <div data-testid="live-tail-panel" />,
}));

vi.mock("@/components/flow/inspector-schema-tab", () => ({
  InspectorSchemaTab: () => <div data-testid="inspector-schema-tab" />,
}));

vi.mock("@/components/flow/inspector-metrics-tab", () => ({
  InspectorMetricsTab: () => <div data-testid="inspector-metrics-tab" />,
}));

vi.mock("@/components/flow/inspector-logs-tab", () => ({
  InspectorLogsTab: () => <div data-testid="inspector-logs-tab" />,
}));

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext<{
    value: string;
    setValue: (value: string) => void;
  } | null>(null);

  function useTabsContext() {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error("Tabs mock used outside provider");
    return context;
  }

  return {
    Tabs: ({
      defaultValue,
      children,
      ...props
    }: {
      defaultValue: string;
      children: React.ReactNode;
    }) => {
      const [value, setValue] = React.useState(defaultValue);
      return (
        <TabsContext.Provider value={{ value, setValue }}>
          <div {...props}>{children}</div>
        </TabsContext.Provider>
      );
    },
    TabsList: ({ children, ...props }: { children: React.ReactNode }) => (
      <div role="tablist" {...props}>
        {children}
      </div>
    ),
    TabsTrigger: ({
      value,
      children,
      ...props
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const context = useTabsContext();
      return (
        <button
          role="tab"
          type="button"
          aria-selected={context.value === value}
          onClick={() => context.setValue(value)}
          {...props}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({
      value,
      children,
      ...props
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const context = useTabsContext();
      return context.value === value ? <div {...props}>{children}</div> : null;
    },
  };
});

import { DetailPanel } from "../detail-panel";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeNode(id: string, overrides: Partial<Node["data"]> = {}): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    type: "source",
    data: {
      componentDef: {
        type: "kafka",
        kind: "source",
        displayName: "Apache Kafka",
        description: "Read from Kafka",
        category: "Messaging",
        icon: "default",
        configSchema: { type: "object", properties: {} },
        outputTypes: ["log"],
      },
      componentKey: "kafka_1",
      displayName: "My Kafka",
      config: {},
      ...overrides,
    },
  };
}

function renderPanel(storeOverrides: Partial<FlowState> = {}) {
  currentStore = { ...baseFlowStore, ...storeOverrides };
  return render(
    <DetailPanel pipelineId="pipeline-1" isDeployed={false} />
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty selection state", () => {
    it("shows 'Select a node to configure it' prompt when no node is selected", () => {
      const { getByText } = renderPanel({ selectedNodeId: null, nodes: [] });
      expect(getByText("Select a node to configure it")).toBeTruthy();
    });

    it("shows Collapse button when panel is expanded and no node is selected", () => {
      const { getByLabelText } = renderPanel({
        selectedNodeId: null,
        detailPanelCollapsed: false,
      });
      expect(getByLabelText("Collapse detail panel")).toBeTruthy();
    });

    it("shows Expand button when panel is collapsed and no node is selected", () => {
      const { getByLabelText } = renderPanel({
        selectedNodeId: null,
        detailPanelCollapsed: true,
      });
      expect(getByLabelText("Expand detail panel")).toBeTruthy();
    });

    it("clicking Collapse toggles the panel", () => {
      const { getByLabelText } = renderPanel({
        selectedNodeId: null,
        detailPanelCollapsed: false,
      });
      fireEvent.click(getByLabelText("Collapse detail panel"));
      expect(mockToggleDetailPanel).toHaveBeenCalledOnce();
    });
  });

  describe("node selected state", () => {
    it("shows node display name when a node is selected", () => {
      const node = makeNode("n1");
      const { getByDisplayValue } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      expect(getByDisplayValue("My Kafka")).toBeTruthy();
    });

    it("renders the delete button for the selected node", () => {
      const node = makeNode("n1");
      const { getByLabelText } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      expect(getByLabelText("Delete component")).toBeTruthy();
    });

    it("clicking delete calls removeNode with the selected node id", () => {
      const node = makeNode("n1");
      const { getByLabelText } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      fireEvent.click(getByLabelText("Delete component"));
      expect(mockRemoveNode).toHaveBeenCalledWith("n1");
    });

    it("shows SchemaForm for configurable nodes", () => {
      const node = makeNode("n1");
      const { getByTestId } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      expect(getByTestId("schema-form")).toBeTruthy();
    });

    it("renders Config / Schema / Metrics / Logs tabs", () => {
      const node = makeNode("n1");
      const { getByRole } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      expect(getByRole("tab", { name: /config/i })).toBeTruthy();
      expect(getByRole("tab", { name: /schema/i })).toBeTruthy();
      expect(getByRole("tab", { name: /metrics/i })).toBeTruthy();
      expect(getByRole("tab", { name: /logs/i })).toBeTruthy();
    });

    it("renders the schema inspector tab content when selected", async () => {
      const node = makeNode("n1");
      const { getByRole, getByTestId } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      fireEvent.click(getByRole("tab", { name: /schema/i }));
      await waitFor(() => expect(getByTestId("inspector-schema-tab")).toBeTruthy());
    });

    it("renders the metrics inspector tab content when selected", async () => {
      const node = makeNode("n1");
      const { getByRole, getByTestId } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      fireEvent.click(getByRole("tab", { name: /metrics/i }));
      await waitFor(() => expect(getByTestId("inspector-metrics-tab")).toBeTruthy());
    });

    it("renders the logs inspector tab content when selected", async () => {
      const node = makeNode("n1");
      const { getByRole, getByTestId } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      fireEvent.click(getByRole("tab", { name: /logs/i }));
      await waitFor(() => expect(getByTestId("inspector-logs-tab")).toBeTruthy());
    });

    it("renders the inspector header with mono kind label", () => {
      const node = makeNode("n1");
      const { getByText } = renderPanel({
        selectedNodeId: "n1",
        nodes: [node],
      });
      expect(getByText(/source · kafka/i)).toBeTruthy();
    });
  });
});
