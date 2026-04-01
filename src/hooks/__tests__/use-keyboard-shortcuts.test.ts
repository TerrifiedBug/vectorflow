// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ── Hoisted mocks ────────────────────────────────────────────────────

const {
  mockUndo,
  mockRedo,
  mockRemoveNode,
  mockRemoveEdge,
  mockCopySelectedNodes,
  mockPasteFromSession,
  mockDuplicateNode,
  mockDeselectAll,
} = vi.hoisted(() => ({
  mockUndo: vi.fn(),
  mockRedo: vi.fn(),
  mockRemoveNode: vi.fn(),
  mockRemoveEdge: vi.fn(),
  mockCopySelectedNodes: vi.fn(),
  mockPasteFromSession: vi.fn(),
  mockDuplicateNode: vi.fn(),
  mockDeselectAll: vi.fn(),
}));

let mockSelectedNodeId: string | null = null;
let mockSelectedEdgeId: string | null = null;
let mockSelectedNodeIds = new Set<string>();
let mockNodes: Array<{ id: string; data: { isSystemLocked?: boolean } }> = [];

vi.mock("@/stores/flow-store", () => ({
  useFlowStore: Object.assign(
    vi.fn((selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        undo: mockUndo,
        redo: mockRedo,
        selectedNodeId: mockSelectedNodeId,
        selectedEdgeId: mockSelectedEdgeId,
        removeNode: mockRemoveNode,
        removeEdge: mockRemoveEdge,
        copySelectedNodes: mockCopySelectedNodes,
        pasteFromSession: mockPasteFromSession,
        duplicateNode: mockDuplicateNode,
        selectedNodeIds: mockSelectedNodeIds,
      };
      return selector(state);
    }),
    {
      getState: vi.fn(() => ({
        nodes: mockNodes,
        deselectAll: mockDeselectAll,
      })),
    },
  ),
}));

// ── Import under test (after mocks) ─────────────────────────────────

import { useKeyboardShortcuts } from "../use-keyboard-shortcuts";

// ── DOM helpers ──────────────────────────────────────────────────────

let canvasDiv: HTMLDivElement | null = null;
// A generic element outside the canvas for non-canvas-focused dispatching
let outsideDiv: HTMLDivElement | null = null;

function setupDOM(): void {
  canvasDiv = document.createElement("div");
  canvasDiv.className = "react-flow";
  document.body.appendChild(canvasDiv);

  outsideDiv = document.createElement("div");
  outsideDiv.className = "outside";
  document.body.appendChild(outsideDiv);
}

function cleanupDOM(): void {
  if (canvasDiv) {
    document.body.removeChild(canvasDiv);
    canvasDiv = null;
  }
  if (outsideDiv) {
    document.body.removeChild(outsideDiv);
    outsideDiv = null;
  }
}

/**
 * Dispatch a KeyboardEvent from within the .react-flow canvas element.
 * Events bubble up to window where the hook handler listens.
 */
function dispatchKeyOnCanvas(
  key: string,
  opts: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  if (!canvasDiv) throw new Error("Canvas not set up — call setupDOM() first");
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  canvasDiv.dispatchEvent(event);
  return event;
}

/**
 * Dispatch a KeyboardEvent from outside the .react-flow canvas.
 * Events still bubble to window but target.closest('.react-flow') returns null.
 */
function dispatchKeyOutside(
  key: string,
  opts: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  if (!outsideDiv) throw new Error("DOM not set up — call setupDOM() first");
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  outsideDiv.dispatchEvent(event);
  return event;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("useKeyboardShortcuts", () => {
  const onSave = vi.fn();
  const onExport = vi.fn();
  const onImport = vi.fn();
  let unmountHook: (() => void) | null = null;

  function renderShortcutsHook() {
    const result = renderHook(() =>
      useKeyboardShortcuts({ onSave, onExport, onImport }),
    );
    unmountHook = result.unmount;
    return result;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedNodeId = null;
    mockSelectedEdgeId = null;
    mockSelectedNodeIds = new Set();
    mockNodes = [];
    setupDOM();
  });

  afterEach(() => {
    // Unmount hook to remove the keydown listener before the next test
    unmountHook?.();
    unmountHook = null;
    cleanupDOM();
  });

  it("Ctrl+Z triggers undo", () => {
    renderShortcutsHook();

    dispatchKeyOutside("z", { ctrlKey: true });

    expect(mockUndo).toHaveBeenCalledOnce();
    expect(mockRedo).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+Z triggers redo", () => {
    renderShortcutsHook();

    dispatchKeyOutside("z", { ctrlKey: true, shiftKey: true });

    expect(mockRedo).toHaveBeenCalledOnce();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it("Ctrl+S triggers onSave", () => {
    renderShortcutsHook();

    const event = dispatchKeyOutside("s", { ctrlKey: true });

    expect(onSave).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+C on canvas with selected node triggers copySelectedNodes", () => {
    mockSelectedNodeId = "node-1";

    renderShortcutsHook();

    dispatchKeyOnCanvas("c", { ctrlKey: true });

    expect(mockCopySelectedNodes).toHaveBeenCalledOnce();
  });

  it("Ctrl+C outside canvas does not trigger copySelectedNodes", () => {
    mockSelectedNodeId = "node-1";

    renderShortcutsHook();

    dispatchKeyOutside("c", { ctrlKey: true });

    expect(mockCopySelectedNodes).not.toHaveBeenCalled();
  });

  it("Ctrl+V on canvas triggers pasteFromSession", () => {
    renderShortcutsHook();

    dispatchKeyOnCanvas("v", { ctrlKey: true });

    expect(mockPasteFromSession).toHaveBeenCalledOnce();
  });

  it("Delete key on canvas with selected node triggers removeNode", () => {
    mockSelectedNodeId = "node-1";
    mockNodes = [{ id: "node-1", data: {} }];

    renderShortcutsHook();

    dispatchKeyOnCanvas("Delete", {});

    expect(mockRemoveNode).toHaveBeenCalledWith("node-1");
  });

  it("Delete key does not remove system-locked nodes", () => {
    mockSelectedNodeId = "node-1";
    mockNodes = [{ id: "node-1", data: { isSystemLocked: true } }];

    renderShortcutsHook();

    dispatchKeyOnCanvas("Delete", {});

    expect(mockRemoveNode).not.toHaveBeenCalled();
  });

  it("Delete key on canvas with selected edge triggers removeEdge", () => {
    mockSelectedEdgeId = "edge-1";

    renderShortcutsHook();

    dispatchKeyOnCanvas("Delete", {});

    expect(mockRemoveEdge).toHaveBeenCalledWith("edge-1");
  });

  it("Escape on canvas triggers deselectAll", () => {
    renderShortcutsHook();

    dispatchKeyOnCanvas("Escape", {});

    expect(mockDeselectAll).toHaveBeenCalledOnce();
  });

  it("shortcuts are suppressed when target is an INPUT element", () => {
    renderShortcutsHook();

    const input = document.createElement("input");
    document.body.appendChild(input);

    try {
      const event = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);

      // Undo should not fire when typing in an input
      expect(mockUndo).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(input);
    }
  });

  it("Ctrl+S still fires even when focused on an INPUT element", () => {
    renderShortcutsHook();

    const input = document.createElement("input");
    document.body.appendChild(input);

    try {
      const event = new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);

      expect(onSave).toHaveBeenCalledOnce();
    } finally {
      document.body.removeChild(input);
    }
  });

  it("Ctrl+E triggers onExport", () => {
    renderShortcutsHook();

    const event = dispatchKeyOutside("e", { ctrlKey: true });

    expect(onExport).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+I triggers onImport", () => {
    renderShortcutsHook();

    dispatchKeyOutside("i", { ctrlKey: true });

    expect(onImport).toHaveBeenCalledOnce();
  });

  it("Ctrl+D on canvas duplicates selected node", () => {
    mockSelectedNodeId = "node-1";
    mockNodes = [{ id: "node-1", data: {} }];

    renderShortcutsHook();

    dispatchKeyOnCanvas("d", { ctrlKey: true });

    expect(mockDuplicateNode).toHaveBeenCalledWith("node-1");
  });

  it("Ctrl+D does not duplicate system-locked nodes", () => {
    mockSelectedNodeId = "node-1";
    mockNodes = [{ id: "node-1", data: { isSystemLocked: true } }];

    renderShortcutsHook();

    dispatchKeyOnCanvas("d", { ctrlKey: true });

    expect(mockDuplicateNode).not.toHaveBeenCalled();
  });

  it("Backspace on canvas with selected node triggers removeNode", () => {
    mockSelectedNodeId = "node-1";
    mockNodes = [{ id: "node-1", data: {} }];

    renderShortcutsHook();

    dispatchKeyOnCanvas("Backspace", {});

    expect(mockRemoveNode).toHaveBeenCalledWith("node-1");
  });
});
