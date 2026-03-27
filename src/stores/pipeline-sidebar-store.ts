import { create } from "zustand";

interface PipelineSidebarStore {
  selectedGroupId: string | null;
  expandedGroupIds: Set<string>;
  manageGroupsOpen: boolean;
  setSelectedGroupId: (id: string | null) => void;
  toggleExpandedGroup: (id: string) => void;
  setExpandedGroupIds: (ids: Set<string>) => void;
  setManageGroupsOpen: (open: boolean) => void;
}

export const usePipelineSidebarStore = create<PipelineSidebarStore>()((set) => ({
  selectedGroupId: null,
  expandedGroupIds: new Set<string>(),
  manageGroupsOpen: false,
  setSelectedGroupId: (id) => set({ selectedGroupId: id }),
  toggleExpandedGroup: (id) =>
    set((state) => {
      const next = new Set(state.expandedGroupIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { expandedGroupIds: next };
    }),
  setExpandedGroupIds: (ids) => set({ expandedGroupIds: ids }),
  setManageGroupsOpen: (open) => set({ manageGroupsOpen: open }),
}));
