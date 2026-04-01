// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted mocks (available inside vi.mock factories) ───────────────

const {
  mockStartDeploy,
  mockFinishDeploy,
  mockSetToastId,
  mockDismiss,
  mockGetState,
  mockMutate,
  mockQueryClient,
  mockTrpc,
} = vi.hoisted(() => ({
  mockStartDeploy: vi.fn(),
  mockFinishDeploy: vi.fn(),
  mockSetToastId: vi.fn(),
  mockDismiss: vi.fn(),
  mockGetState: vi.fn(() => ({
    results: [
      { pipelineId: "p1", pipelineName: "Pipeline 1", status: "pending" },
      { pipelineId: "p2", pipelineName: "Pipeline 2", status: "pending" },
    ],
  })),
  mockMutate: vi.fn(),
  mockQueryClient: {
    invalidateQueries: vi.fn(),
  },
  mockTrpc: {
    pipeline: {
      deployBatch: {
        mutationOptions: vi.fn((opts: Record<string, unknown>) => opts),
      },
      list: { queryKey: vi.fn(() => ["pipeline", "list"]) },
      batchHealth: { queryKey: vi.fn(() => ["pipeline", "batchHealth"]) },
    },
  },
}));

let capturedMutationOptions: Record<string, (...args: unknown[]) => void> = {};
let mockIsPending = false;

// ── Module mocks ─────────────────────────────────────────────────────

vi.mock("@/stores/deploy-progress-store", () => ({
  useDeployProgressStore: Object.assign(
    vi.fn(() => ({
      startDeploy: mockStartDeploy,
      finishDeploy: mockFinishDeploy,
      setToastId: mockSetToastId,
      dismiss: mockDismiss,
    })),
    {
      getState: mockGetState,
    },
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn((opts: Record<string, unknown>) => {
    capturedMutationOptions = opts as Record<
      string,
      (...args: unknown[]) => void
    >;
    return { mutate: mockMutate, isPending: mockIsPending };
  }),
  useQueryClient: vi.fn(() => mockQueryClient),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: vi.fn(() => mockTrpc),
}));

vi.mock("sonner", () => {
  const customFn = vi.fn(() => "toast-123");
  const errorFn = vi.fn();
  const toastObj = Object.assign(vi.fn(), {
    custom: customFn,
    error: errorFn,
  });
  return { toast: toastObj };
});

vi.mock("@/components/deploy-progress", () => ({
  DeployProgressPanel: vi.fn(() => null),
}));

// ── Import under test (after mocks) ─────────────────────────────────

import { useDeployProgress } from "../use-deploy-progress";
import { toast } from "sonner";

// ── Tests ────────────────────────────────────────────────────────────

describe("useDeployProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMutationOptions = {};
    mockIsPending = false;
  });

  it("startBatchDeploy calls startDeploy, shows toast, and fires mutation", () => {
    const { result } = renderHook(() => useDeployProgress());

    const pipelines = [
      { id: "p1", name: "Pipeline 1" },
      { id: "p2", name: "Pipeline 2" },
    ];

    act(() => {
      result.current.startBatchDeploy(pipelines, "deploy v2");
    });

    // startDeploy called with pipelines
    expect(mockStartDeploy).toHaveBeenCalledWith(pipelines);

    // Toast shown
    expect(toast.custom).toHaveBeenCalledWith(expect.any(Function), {
      duration: Infinity,
      dismissible: false,
    });

    // setToastId called with the toast ID
    expect(mockSetToastId).toHaveBeenCalledWith("toast-123");

    // Mutation fired with pipeline IDs and changelog
    expect(mockMutate).toHaveBeenCalledWith({
      pipelineIds: ["p1", "p2"],
      changelog: "deploy v2",
    });
  });

  it("isPending reflects mutation state", () => {
    mockIsPending = true;

    const { result } = renderHook(() => useDeployProgress());
    expect(result.current.isPending).toBe(true);
  });

  it("onSuccess callback calls finishDeploy and invalidates queries", () => {
    renderHook(() => useDeployProgress());

    const successData = {
      results: [
        { pipelineId: "p1", success: true },
        { pipelineId: "p2", success: false, error: "timeout" },
      ],
    };

    // Simulate mutation success
    act(() => {
      capturedMutationOptions.onSuccess?.(successData);
    });

    expect(mockFinishDeploy).toHaveBeenCalledWith(
      successData.results,
      expect.any(Map),
    );

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pipeline", "list"],
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pipeline", "batchHealth"],
    });
  });

  it("onError callback dismisses progress and shows error toast", () => {
    renderHook(() => useDeployProgress());

    const error = new Error("Network failure");

    act(() => {
      capturedMutationOptions.onError?.(error);
    });

    expect(mockDismiss).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Network failure", {
      duration: 6000,
    });
  });
});
