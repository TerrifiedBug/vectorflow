// src/stores/deploy-progress-store.ts
import { create } from "zustand";

export interface DeployPipelineResult {
  pipelineId: string;
  pipelineName: string;
  status: "pending" | "success" | "failed";
  error?: string;
}

interface DeployProgressState {
  isActive: boolean;
  total: number;
  completed: number;
  failed: number;
  results: DeployPipelineResult[];
  toastId: string | number | null;
  startDeploy: (pipelines: Array<{ id: string; name: string }>) => void;
  updateResult: (pipelineId: string, status: "success" | "failed", error?: string) => void;
  finishDeploy: (results: Array<{ pipelineId: string; success: boolean; error?: string }>, pipelineNames: Map<string, string>) => void;
  dismiss: () => void;
  setToastId: (id: string | number) => void;
}

export const useDeployProgressStore = create<DeployProgressState>()((set) => ({
  isActive: false,
  total: 0,
  completed: 0,
  failed: 0,
  results: [],
  toastId: null,

  startDeploy: (pipelines) =>
    set({
      isActive: true,
      total: pipelines.length,
      completed: 0,
      failed: 0,
      results: pipelines.map((p) => ({
        pipelineId: p.id,
        pipelineName: p.name,
        status: "pending" as const,
      })),
    }),

  updateResult: (pipelineId, status, error) =>
    set((state) => {
      const updatedResults = state.results.map((r) =>
        r.pipelineId === pipelineId ? { ...r, status, error } : r,
      );
      const completed = updatedResults.filter((r) => r.status !== "pending").length;
      const failed = updatedResults.filter((r) => r.status === "failed").length;
      return { results: updatedResults, completed, failed };
    }),

  finishDeploy: (results, pipelineNames) =>
    set({
      isActive: false,
      total: results.length,
      completed: results.length,
      failed: results.filter((r) => !r.success).length,
      results: results.map((r) => ({
        pipelineId: r.pipelineId,
        pipelineName: pipelineNames.get(r.pipelineId) ?? r.pipelineId,
        status: r.success ? ("success" as const) : ("failed" as const),
        error: r.error,
      })),
    }),

  dismiss: () =>
    set({
      isActive: false,
      total: 0,
      completed: 0,
      failed: 0,
      results: [],
      toastId: null,
    }),

  setToastId: (id) => set({ toastId: id }),
}));
