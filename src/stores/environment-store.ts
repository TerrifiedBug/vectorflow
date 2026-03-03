import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EnvironmentStore {
  selectedEnvironmentId: string | null;
  isSystemEnvironment: boolean;
  setSelectedEnvironmentId: (id: string | null) => void;
  setIsSystemEnvironment: (isSystem: boolean) => void;
}

export const useEnvironmentStore = create<EnvironmentStore>()(
  persist(
    (set) => ({
      selectedEnvironmentId: null,
      isSystemEnvironment: false,
      setSelectedEnvironmentId: (id) => set({ selectedEnvironmentId: id }),
      setIsSystemEnvironment: (isSystem) => set({ isSystemEnvironment: isSystem }),
    }),
    {
      name: "vectorflow-environment",
      partialize: (state) => ({ selectedEnvironmentId: state.selectedEnvironmentId }),
    },
  ),
);
