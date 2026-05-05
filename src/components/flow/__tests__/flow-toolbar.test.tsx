// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { FlowState } from "@/stores/flow-store";

afterEach(cleanup);

// ── Dependency mocks ───────────────────────────────────────────────────────

const mockUndo = vi.fn();
const mockRedo = vi.fn();
const mockAutoLayout = vi.fn();
const mockRemoveNode = vi.fn();
const mockRemoveEdge = vi.fn();
const mockLoadGraph = vi.fn();
const mockMutate = vi.fn();
const mockSetCanvasSearchTerm = vi.fn();
const mockCycleCanvasSearchMatch = vi.fn();
const mockClearCanvasSearch = vi.fn();

// Build a baseline store state; tests override specific fields via the selector.
const baseStore: Partial<FlowState> = {
  nodes: [],
  edges: [],
  globalConfig: null,
  canUndo: false,
  canRedo: false,
  undo: mockUndo,
  redo: mockRedo,
  removeNode: mockRemoveNode,
  removeEdge: mockRemoveEdge,
  loadGraph: mockLoadGraph,
  autoLayout: mockAutoLayout,
  selectedNodeId: null,
  selectedEdgeId: null,
  selectedNodeIds: new Set(),
  canvasSearchTerm: "",
  canvasSearchMatchIds: [],
  canvasSearchActiveIndex: 0,
  setCanvasSearchTerm: mockSetCanvasSearchTerm,
  cycleCanvasSearchMatch: mockCycleCanvasSearchMatch,
  clearCanvasSearch: mockClearCanvasSearch,
};

let currentStore = { ...baseStore };

vi.mock("@/stores/flow-store", () => ({
  useFlowStore: (selector: (s: typeof currentStore) => unknown) =>
    selector(currentStore),
}));

vi.mock("@/hooks/use-canvas-search", () => ({
  useCanvasSearch: () => undefined,
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    deploy: {
      listPendingRequests: {
        queryOptions: vi.fn(() => ({
          queryKey: ["deploy", "listPendingRequests"],
          queryFn: () => Promise.resolve([]),
        })),
      },
      cancelDeployRequest: {
        mutationOptions: vi.fn((opts) => opts),
      },
    },
    validator: {
      validate: {
        mutationOptions: vi.fn((opts) => opts),
      },
    },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: (opts: unknown) => ({
    mutate: mockMutate,
    isPending: false,
    ...((opts as { onSuccess?: unknown }) ?? {}),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn(() => "sources: {}"),
  generateVectorToml: vi.fn(() => '[sources]\n'),
  importVectorConfig: vi.fn(() => ({ nodes: [], edges: [], globalConfig: null, warnings: [] })),
}));

vi.mock("@/components/pipeline/version-history-dialog", () => ({
  VersionHistoryDialog: () => null,
}));

vi.mock("@/components/flow/keyboard-shortcuts-dialog", () => ({
  KeyboardShortcutsDialog: () => null,
}));

vi.mock("@/components/flow/pipeline-settings", () => ({
  PipelineSettings: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { FlowToolbar } from "../flow-toolbar";
import { generateVectorYaml, importVectorConfig } from "@/lib/config-generator";

// ── Helpers ────────────────────────────────────────────────────────────────

function renderToolbar(overrides: Partial<FlowState> = {}, propOverrides: Partial<React.ComponentProps<typeof FlowToolbar>> = {}) {
  currentStore = { ...baseStore, ...overrides };
  return render(
    <FlowToolbar
      onSave={vi.fn()}
      isDirty={false}
      {...propOverrides}
    />
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FlowToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("import config", () => {
    it("imports pasted YAML into the builder and shows parser warnings", async () => {
      const importedNodes = [{ id: "source-1" }] as never;
      const importedEdges = [{ id: "edge-1" }] as never;
      vi.mocked(importVectorConfig).mockReturnValueOnce({
        nodes: importedNodes,
        edges: importedEdges,
        globalConfig: { api: { enabled: true } },
        warnings: ["Source orphan_source has no downstream consumers"],
      });

      const { getByLabelText, getByText } = renderToolbar();

      fireEvent.click(getByLabelText("Import config"));
      fireEvent.change(getByLabelText("Vector config"), {
        target: { value: "sources:\n  orphan_source:\n    type: demo_logs" },
      });
      fireEvent.click(getByText("Import YAML"));

      await waitFor(() => {
        expect(mockLoadGraph).toHaveBeenCalledWith(
          importedNodes,
          importedEdges,
          { api: { enabled: true } },
        );
      });
      expect(importVectorConfig).toHaveBeenCalledWith(
        "sources:\n  orphan_source:\n    type: demo_logs",
        "yaml",
      );
      expect(getByText("Source orphan_source has no downstream consumers")).toBeTruthy();
    });

    it("validates the imported graph and shows actionable validation feedback", async () => {
      const importedNodes = [{ id: "bad_source" }] as never;
      const importedEdges = [] as never;
      vi.mocked(importVectorConfig).mockReturnValueOnce({
        nodes: importedNodes,
        edges: importedEdges,
        globalConfig: null,
        warnings: [],
      });
      vi.mocked(generateVectorYaml).mockReturnValueOnce("sources:\n  bad_source:\n    type: bad_source");
      mockMutate.mockImplementationOnce((_vars, callbacks) => {
        callbacks?.onSuccess?.({
          valid: false,
          errors: [{ message: "Unknown source type", componentKey: "bad_source" }],
          warnings: [{ message: "Transforms require at least one downstream sink" }],
        });
      });

      const { getByLabelText, getByText } = renderToolbar();

      fireEvent.click(getByLabelText("Import config"));
      fireEvent.change(getByLabelText("Vector config"), {
        target: { value: "sources:\n  bad_source:\n    type: bad_source" },
      });
      fireEvent.click(getByText("Import YAML"));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          { yaml: "sources:\n  bad_source:\n    type: bad_source" },
          expect.objectContaining({
            onSuccess: expect.any(Function),
            onError: expect.any(Function),
          }),
        );
      });
      expect(generateVectorYaml).toHaveBeenCalledWith(importedNodes, importedEdges, null);
      expect(getByText("1 validation error")).toBeTruthy();
      expect(getByText("bad_source: Unknown source type")).toBeTruthy();
      expect(getByText("Transforms require at least one downstream sink")).toBeTruthy();
    });

    it("shows validation unavailable when the Vector binary is missing", async () => {
      vi.mocked(importVectorConfig).mockReturnValueOnce({
        nodes: [],
        edges: [],
        globalConfig: null,
        warnings: [],
      });
      mockMutate.mockImplementationOnce((_vars, callbacks) => {
        callbacks?.onSuccess?.({
          valid: false,
          errors: ["Vector binary not found at /usr/local/bin/vector"],
          warnings: [],
        });
      });

      const { getByLabelText, getByText, queryByText } = renderToolbar();

      fireEvent.click(getByLabelText("Import config"));
      fireEvent.change(getByLabelText("Vector config"), {
        target: { value: "sources:\n  demo:\n    type: demo_logs" },
      });
      fireEvent.click(getByText("Import YAML"));

      await waitFor(() => {
        expect(getByText("Validation unavailable")).toBeTruthy();
      });
      expect(getByText("Vector binary not found at /usr/local/bin/vector")).toBeTruthy();
      expect(queryByText("1 validation error")).not.toBeInTheDocument();
    });

    it("clears parser warnings when a later import fails", async () => {
      vi.mocked(importVectorConfig)
        .mockReturnValueOnce({
          nodes: [],
          edges: [],
          globalConfig: null,
          warnings: ["Source orphan_source has no downstream consumers"],
        })
        .mockImplementationOnce(() => {
          throw new Error("Invalid config");
        });

      const { getByLabelText, getByText, queryByText } = renderToolbar();

      fireEvent.click(getByLabelText("Import config"));
      fireEvent.change(getByLabelText("Vector config"), {
        target: { value: "sources:\n  orphan_source:\n    type: demo_logs" },
      });
      fireEvent.click(getByText("Import YAML"));

      expect(getByText("Source orphan_source has no downstream consumers")).toBeTruthy();

      fireEvent.change(getByLabelText("Vector config"), {
        target: { value: "not: [valid" },
      });
      fireEvent.click(getByText("Import YAML"));

      expect(queryByText("Source orphan_source has no downstream consumers")).not.toBeInTheDocument();
    });

    it("ignores stale validation results from earlier imports", async () => {
      let firstImportSuccess: ((result: { valid: true; warnings: [] }) => void) | undefined;
      vi.mocked(importVectorConfig)
        .mockReturnValueOnce({
          nodes: [{ id: "first" }] as never,
          edges: [],
          globalConfig: null,
          warnings: [],
        })
        .mockReturnValueOnce({
          nodes: [{ id: "second" }] as never,
          edges: [],
          globalConfig: null,
          warnings: [],
        });
      mockMutate
        .mockImplementationOnce((_vars, callbacks) => {
          firstImportSuccess = callbacks?.onSuccess;
        })
        .mockImplementationOnce((_vars, callbacks) => {
          callbacks?.onSuccess?.({
            valid: false,
            errors: [{ message: "Second import error", componentKey: "second" }],
            warnings: [],
          });
        });

      const { getByLabelText, getByText, queryByText } = renderToolbar();

      fireEvent.click(getByLabelText("Import config"));
      fireEvent.change(getByLabelText("Vector config"), {
        target: { value: "sources:\n  first:\n    type: demo_logs" },
      });
      fireEvent.click(getByText("Import YAML"));
      fireEvent.change(getByLabelText("Vector config"), {
        target: { value: "sources:\n  second:\n    type: bad_source" },
      });
      fireEvent.click(getByText("Import YAML"));

      expect(getByText("second: Second import error")).toBeTruthy();

      await act(async () => {
        firstImportSuccess?.({ valid: true, warnings: [] });
      });

      expect(getByText("second: Second import error")).toBeTruthy();
      expect(queryByText("Imported config is valid")).not.toBeInTheDocument();
    });
  });

  describe("undo / redo buttons", () => {
    it("undo button is disabled when canUndo is false", () => {
      const { container } = renderToolbar({ canUndo: false });
      const btn = container.querySelector('[aria-label="Undo"]') as HTMLButtonElement;
      expect(btn).toBeDisabled();
    });

    it("undo button is enabled when canUndo is true", () => {
      const { container } = renderToolbar({ canUndo: true });
      const btn = container.querySelector('[aria-label="Undo"]') as HTMLButtonElement;
      expect(btn).not.toBeDisabled();
    });

    it("clicking undo calls the undo action", () => {
      const { container } = renderToolbar({ canUndo: true });
      const btn = container.querySelector('[aria-label="Undo"]') as HTMLButtonElement;
      fireEvent.click(btn);
      expect(mockUndo).toHaveBeenCalledOnce();
    });

    it("redo button is disabled when canRedo is false", () => {
      const { container } = renderToolbar({ canRedo: false });
      const btn = container.querySelector('[aria-label="Redo"]') as HTMLButtonElement;
      expect(btn).toBeDisabled();
    });

    it("redo button is enabled when canRedo is true", () => {
      const { container } = renderToolbar({ canRedo: true });
      const btn = container.querySelector('[aria-label="Redo"]') as HTMLButtonElement;
      expect(btn).not.toBeDisabled();
    });
  });

  describe("save button", () => {
    it("shows dirty indicator dot when isDirty is true", () => {
      const { container } = renderToolbar({}, { isDirty: true });
      const saveBtn = container.querySelector('[aria-label="Save pipeline"]') as HTMLElement;
      // The dirty dot is a span child of the save button
      const dot = saveBtn?.querySelector("span");
      expect(dot).toBeTruthy();
    });

    it("save button is disabled when not dirty", () => {
      const { container } = renderToolbar({}, { isDirty: false });
      const btn = container.querySelector('[aria-label="Save pipeline"]') as HTMLButtonElement;
      expect(btn).toBeDisabled();
    });
  });

  describe("toolbar grouping", () => {
    it("groups export, template, and history actions under Config", () => {
      const onSaveAsTemplate = vi.fn();
      const { getByLabelText, getByText } = renderToolbar(
        { nodes: [{ id: "n1" } as never] },
        { pipelineId: "pipe-1", onSaveAsTemplate },
      );

      fireEvent.pointerDown(getByLabelText("Config actions"), { button: 0, ctrlKey: false });

      expect(getByText("Download YAML")).toBeTruthy();
      expect(getByText("Download TOML")).toBeTruthy();
      expect(getByText("Version history")).toBeTruthy();
      fireEvent.click(getByText("Save as template"));
      expect(onSaveAsTemplate).toHaveBeenCalledOnce();
    });

    it("groups observability actions under View and keeps the error indicator discoverable", () => {
      const onToggleMetrics = vi.fn();
      const onToggleLogs = vi.fn();
      const { getByLabelText, getByText } = renderToolbar(
        {},
        {
          pipelineId: "pipe-1",
          onToggleMetrics,
          onToggleLogs,
          hasRecentErrors: true,
        },
      );

      fireEvent.pointerDown(getByLabelText("View actions"), { button: 0, ctrlKey: false });

      expect(getByText("Show metrics")).toBeTruthy();
      expect(getByText("Show logs")).toBeTruthy();
      expect(getByText("Pipeline scorecard")).toBeTruthy();
      fireEvent.click(getByText("Show metrics"));
      expect(onToggleMetrics).toHaveBeenCalledOnce();
    });

    it("groups canvas tools under Tools", () => {
      const { getByLabelText, getByText } = renderToolbar(
        { nodes: [{ id: "n1" } as never], selectedNodeIds: new Set(["n1", "n2"]) },
        { aiEnabled: true, onAiOpen: vi.fn() },
      );

      fireEvent.pointerDown(getByLabelText("Tools actions"), { button: 0, ctrlKey: false });
      expect(getByText("AI assistant")).toBeTruthy();
      expect(getByText("Keyboard shortcuts")).toBeTruthy();
      fireEvent.click(getByText("Auto-layout selected"));

      expect(mockAutoLayout).toHaveBeenCalledWith(true);
    });
  });

  describe("process status indicator", () => {
    it("shows 'running' label when processStatus is RUNNING", () => {
      const { getByText } = renderToolbar({}, { processStatus: "RUNNING" });
      expect(getByText(/running/)).toBeTruthy();
    });

    it("shows 'crashed' label when processStatus is CRASHED", () => {
      const { getByText } = renderToolbar({}, { processStatus: "CRASHED" });
      expect(getByText(/crashed/)).toBeTruthy();
    });

    it("shows 'paused' label when processStatus is STOPPED", () => {
      const { getByText } = renderToolbar({}, { processStatus: "STOPPED" });
      expect(getByText(/paused/)).toBeTruthy();
    });

    it("shows 'starting' label when processStatus is STARTING", () => {
      const { getByText } = renderToolbar({}, { processStatus: "STARTING" });
      expect(getByText(/starting/)).toBeTruthy();
    });

    it("appends node count when nodeCount is provided", () => {
      const { getByText } = renderToolbar(
        {},
        { processStatus: "RUNNING", nodeCount: 12 },
      );
      expect(getByText(/running · 12 nodes/)).toBeTruthy();
    });
  });

  describe("pipeline metadata", () => {
    it("renders pipeline name, env pill, and version label when provided", () => {
      const { getByText } = renderToolbar(
        {},
        {
          pipelineName: "auditbeat.logs",
          environmentName: "prod",
          deployedVersionNumber: 11,
        },
      );
      expect(getByText("auditbeat.logs")).toBeTruthy();
      expect(getByText("prod")).toBeTruthy();
      expect(getByText("v11")).toBeTruthy();
    });

    it("renders last saved label when provided", () => {
      const { getByText } = renderToolbar(
        {},
        { lastSavedLabel: "14s ago" },
      );
      expect(getByText("last saved 14s ago")).toBeTruthy();
    });

    it("commits inline rename via Enter and calls onRename with trimmed value exactly once", () => {
      const onRename = vi.fn();
      const { getByText, getByLabelText } = renderToolbar(
        {},
        { pipelineName: "old-name", onRename },
      );

      fireEvent.click(getByText("old-name"));
      const input = getByLabelText("Pipeline name") as HTMLInputElement;
      input.focus();
      fireEvent.change(input, { target: { value: "  new-name  " } });
      // Bug repro (HIGH): pressing Enter triggers commitRename, which unmounts
      // the input. The focus loss on the still-mounted-this-tick element fires
      // onBlur, which would re-invoke commitRename. We collapse that real-world
      // race into a single synchronous batch via act() — both handlers run
      // against the still-mounted input. commitRename must guard against the
      // second call so onRename only fires once.
      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
        fireEvent.blur(input);
      });

      expect(onRename).toHaveBeenCalledWith("new-name");
      expect(onRename).toHaveBeenCalledTimes(1);
    });

    it("cancels inline rename on Escape and does not call onRename", () => {
      const onRename = vi.fn();
      const { getByText, getByLabelText } = renderToolbar(
        {},
        { pipelineName: "old-name", onRename },
      );

      fireEvent.click(getByText("old-name"));
      const input = getByLabelText("Pipeline name") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "new-name" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onRename).not.toHaveBeenCalled();
    });
  });

  describe("deploy button state", () => {
    it("shows Deploy button when pipeline is a draft (never deployed)", () => {
      const { container } = renderToolbar({ nodes: [{ id: "n1" } as never] }, {
        isDraft: true,
        deployedAt: null,
      });
      // Use querySelector to avoid matching tooltip text content
      const btn = container.querySelector('[data-variant="primary"]') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn?.textContent).toMatch(/Deploy/);
    });

    it("Deploy button is disabled when there are no nodes", () => {
      const { container } = renderToolbar({ nodes: [] }, { isDraft: true });
      const btn = container.querySelector('[data-variant="primary"]') as HTMLButtonElement;
      expect(btn).toBeDisabled();
    });

    it("shows 'Deployed' status when pipeline is deployed and up-to-date", () => {
      const { getByText } = renderToolbar({ nodes: [{ id: "n1" } as never] }, {
        isDraft: false,
        deployedAt: new Date().toISOString(),
        hasConfigChanges: false,
      });
      expect(getByText(/Deployed/)).toBeTruthy();
    });
  });
});
