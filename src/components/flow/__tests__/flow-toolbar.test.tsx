// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
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
    mutate: vi.fn(),
    isPending: false,
    ...((opts as { onSuccess?: unknown }) ?? {}),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn(() => "sources: {}"),
  generateVectorToml: vi.fn(() => '[sources]\n'),
  importVectorConfig: vi.fn(() => ({ nodes: [], edges: [], globalConfig: null })),
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

  describe("process status indicator", () => {
    it("shows 'Running' label when processStatus is RUNNING", () => {
      const { getByText } = renderToolbar({}, { processStatus: "RUNNING" });
      expect(getByText("Running")).toBeTruthy();
    });

    it("shows 'Crashed' label when processStatus is CRASHED", () => {
      const { getByText } = renderToolbar({}, { processStatus: "CRASHED" });
      expect(getByText("Crashed")).toBeTruthy();
    });

    it("shows 'Stopped' label when processStatus is STOPPED", () => {
      const { getByText } = renderToolbar({}, { processStatus: "STOPPED" });
      expect(getByText("Stopped")).toBeTruthy();
    });

    it("shows 'Starting' label when processStatus is STARTING", () => {
      const { getByText } = renderToolbar({}, { processStatus: "STARTING" });
      expect(getByText("Starting...")).toBeTruthy();
    });
  });

  describe("deploy button state", () => {
    it("shows Deploy button when pipeline is a draft (never deployed)", () => {
      const { container } = renderToolbar({ nodes: [{ id: "n1" } as never] }, {
        isDraft: true,
        deployedAt: null,
      });
      // Use querySelector to avoid matching tooltip text content
      const btn = container.querySelector('.bg-primary') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn?.textContent).toMatch(/Deploy/);
    });

    it("Deploy button is disabled when there are no nodes", () => {
      const { container } = renderToolbar({ nodes: [] }, { isDraft: true });
      const btn = container.querySelector('.bg-primary') as HTMLButtonElement;
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
