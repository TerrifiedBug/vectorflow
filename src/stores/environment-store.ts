import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EnvironmentStore {
  selectedEnvironmentId: string | null;
  setSelectedEnvironmentId: (id: string | null) => void;
}

export const useEnvironmentStore = create<EnvironmentStore>()(
  persist(
    (set) => ({
      selectedEnvironmentId: null,
      setSelectedEnvironmentId: (id) => set({ selectedEnvironmentId: id }),
    }),
    { name: "vectorflow-environment" },
  ),
);
