import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEnvironmentStore } from "./environment-store";

interface TeamStore {
  selectedTeamId: string | null;
  setSelectedTeamId: (id: string | null) => void;
}

export const useTeamStore = create<TeamStore>()(
  persist(
    (set) => ({
      selectedTeamId: null,
      setSelectedTeamId: (id) => {
        set({ selectedTeamId: id });
        // Reset environment selection when team changes
        useEnvironmentStore.getState().setSelectedEnvironmentId(null);
      },
    }),
    { name: "vectorflow-team" },
  ),
);
