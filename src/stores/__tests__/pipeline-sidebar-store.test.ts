import { describe, it, expect, beforeEach } from "vitest";
import { usePipelineSidebarStore } from "@/stores/pipeline-sidebar-store";

describe("usePipelineSidebarStore", () => {
  beforeEach(() => {
    usePipelineSidebarStore.setState({
      selectedGroupId: null,
      expandedGroupIds: new Set(),
      manageGroupsOpen: false,
    });
  });

  it("initial state has selectedGroupId === null", () => {
    const state = usePipelineSidebarStore.getState();
    expect(state.selectedGroupId).toBe(null);
  });

  it("initial state has expandedGroupIds as empty Set", () => {
    const state = usePipelineSidebarStore.getState();
    expect(state.expandedGroupIds).toBeInstanceOf(Set);
    expect(state.expandedGroupIds.size).toBe(0);
  });

  it("initial state has manageGroupsOpen === false", () => {
    const state = usePipelineSidebarStore.getState();
    expect(state.manageGroupsOpen).toBe(false);
  });

  it("setSelectedGroupId('abc') sets selectedGroupId to 'abc'", () => {
    usePipelineSidebarStore.getState().setSelectedGroupId("abc");
    expect(usePipelineSidebarStore.getState().selectedGroupId).toBe("abc");
  });

  it("setSelectedGroupId(null) sets selectedGroupId to null", () => {
    usePipelineSidebarStore.getState().setSelectedGroupId("abc");
    usePipelineSidebarStore.getState().setSelectedGroupId(null);
    expect(usePipelineSidebarStore.getState().selectedGroupId).toBe(null);
  });

  it("toggleExpandedGroup('g1') adds 'g1' to expandedGroupIds", () => {
    usePipelineSidebarStore.getState().toggleExpandedGroup("g1");
    expect(usePipelineSidebarStore.getState().expandedGroupIds.has("g1")).toBe(true);
  });

  it("toggleExpandedGroup('g1') twice removes 'g1' from expandedGroupIds", () => {
    usePipelineSidebarStore.getState().toggleExpandedGroup("g1");
    usePipelineSidebarStore.getState().toggleExpandedGroup("g1");
    expect(usePipelineSidebarStore.getState().expandedGroupIds.has("g1")).toBe(false);
  });

  it("setManageGroupsOpen(true) sets manageGroupsOpen to true", () => {
    usePipelineSidebarStore.getState().setManageGroupsOpen(true);
    expect(usePipelineSidebarStore.getState().manageGroupsOpen).toBe(true);
  });

  it("setManageGroupsOpen(false) sets manageGroupsOpen to false", () => {
    usePipelineSidebarStore.getState().setManageGroupsOpen(true);
    usePipelineSidebarStore.getState().setManageGroupsOpen(false);
    expect(usePipelineSidebarStore.getState().manageGroupsOpen).toBe(false);
  });
});
