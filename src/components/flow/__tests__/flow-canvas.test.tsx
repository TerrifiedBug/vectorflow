// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Node, Connection, Edge } from "@xyflow/react";
import type { VectorComponentDef } from "@/lib/vector/types";

afterEach(cleanup);

// ── Capture isValidConnection from ReactFlow props ─────────────────────────
// We render FlowCanvas and intercept the prop passed to ReactFlow so we can
// call it directly in assertions.
type CapturedProps = {
  isValidConnection?: (connection: Edge | Connection) => boolean;
  onConnect?: (connection: Connection) => void;
  "aria-roledescription"?: string;
};

let capturedReactFlowProps: CapturedProps = {};

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: CapturedProps) => {
    capturedReactFlowProps = props;
    // Omit role/aria-label since FlowCanvas's outer div already has those
    return <div data-testid="react-flow" />;
  },
  Background: () => null,
  Controls: () => null,
  useReactFlow: () => ({
    screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })),
    fitView: vi.fn(),
  }),
}));

// Spy on sonner so we can assert the type-mismatch toast fires on bad connects.
const toastErrorSpy = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorSpy(...args),
  },
}));

// ── Other mocks ────────────────────────────────────────────────────────────

const mockNodes: Node[] = [];
const storeOnConnectSpy = vi.fn();
vi.mock("@/stores/flow-store", () => ({
  useFlowStore: (selector: (s: unknown) => unknown) =>
    selector({
      nodes: mockNodes,
      edges: [],
      onNodesChange: vi.fn(),
      onEdgesChange: vi.fn(),
      onConnect: storeOnConnectSpy,
      addNode: vi.fn(),
      updateNodeConfig: vi.fn(),
      patchNodeSharedData: vi.fn(),
    }),
  // expose getState for DLP path
  getState: () => ({
    nodes: mockNodes,
    updateNodeConfig: vi.fn(),
    patchNodeSharedData: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "pipeline-123" }),
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: () => undefined,
}));

vi.mock("../node-context-menu", () => ({
  NodeContextMenu: () => null,
}));

vi.mock("../edge-context-menu", () => ({
  EdgeContextMenu: () => null,
}));

vi.mock("../save-shared-component-dialog", () => ({
  SaveSharedComponentDialog: () => null,
}));

vi.mock("../node-types", () => ({
  nodeTypes: {},
}));

vi.mock("@/lib/vector/catalog", () => ({
  findComponentDef: vi.fn(() => undefined),
}));

vi.mock("@/lib/vector/dlp-vrl-sources", () => ({
  DLP_VRL_SOURCES: {},
}));

import { FlowCanvas } from "../flow-canvas";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeNode(id: string, outputTypes: string[], inputTypes?: string[]): Node {
  const componentDef: Partial<VectorComponentDef> = { outputTypes: outputTypes as never[], inputTypes: inputTypes as never[] };
  return {
    id,
    position: { x: 0, y: 0 },
    data: { componentDef },
    type: "source",
  };
}

function makeConnection(source: string, target: string): Connection {
  return { source, target, sourceHandle: null, targetHandle: null };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FlowCanvas", () => {
  beforeEach(() => {
    capturedReactFlowProps = {};
    mockNodes.length = 0;
    toastErrorSpy.mockClear();
    storeOnConnectSpy.mockClear();
  });

  describe("canvas structure", () => {
    it("renders the pipeline editor canvas region", () => {
      const { getByRole } = render(<FlowCanvas />);
      expect(getByRole("region", { name: "Pipeline editor canvas" })).toBeTruthy();
    });

    it("renders the outer container with correct role", () => {
      const { container } = render(<FlowCanvas />);
      const region = container.querySelector('[role="region"][aria-label="Pipeline editor canvas"]');
      expect(region).toBeTruthy();
    });
  });

  describe("isValidConnection — DataType compatibility", () => {
    it("returns false for a self-connection", () => {
      mockNodes.push(makeNode("n1", ["log"]));
      render(<FlowCanvas />);
      const { isValidConnection } = capturedReactFlowProps;

      expect(isValidConnection).toBeDefined();
      expect(isValidConnection!(makeConnection("n1", "n1"))).toBe(false);
    });

    it("returns false when source or target node does not exist", () => {
      mockNodes.push(makeNode("n1", ["log"]));
      render(<FlowCanvas />);
      const { isValidConnection } = capturedReactFlowProps;

      // target "n2" is not in mockNodes
      expect(isValidConnection!(makeConnection("n1", "n2"))).toBe(false);
    });

    it("allows connection when types overlap (log → log)", () => {
      mockNodes.push(makeNode("src", ["log"]), makeNode("dst", ["metric"], ["log"]));
      render(<FlowCanvas />);
      const { isValidConnection } = capturedReactFlowProps;

      expect(isValidConnection!(makeConnection("src", "dst"))).toBe(true);
    });

    it("rejects connection when types are incompatible (metric → log only)", () => {
      mockNodes.push(makeNode("src", ["metric"]), makeNode("dst", ["log"], ["log"]));
      render(<FlowCanvas />);
      const { isValidConnection } = capturedReactFlowProps;

      expect(isValidConnection!(makeConnection("src", "dst"))).toBe(false);
    });

    it("allows connection when either side has no type constraints", () => {
      // A node with no outputTypes is type-agnostic — any connection is valid
      mockNodes.push(makeNode("src", []), makeNode("dst", ["log"], ["log"]));
      render(<FlowCanvas />);
      const { isValidConnection } = capturedReactFlowProps;

      expect(isValidConnection!(makeConnection("src", "dst"))).toBe(true);
    });
  });

  describe("onConnect — type-mismatch validator + toast", () => {
    it("rejects mismatched types, fires a toast, and does not commit the edge", () => {
      mockNodes.push(
        makeNode("src", ["metric"]),
        makeNode("dst", ["log"], ["log"]),
      );
      render(<FlowCanvas />);
      const { onConnect } = capturedReactFlowProps;

      expect(onConnect).toBeDefined();
      onConnect!(makeConnection("src", "dst"));

      expect(toastErrorSpy).toHaveBeenCalledTimes(1);
      const [msg] = toastErrorSpy.mock.calls[0];
      expect(typeof msg).toBe("string");
      expect(msg).toMatch(/Type mismatch/i);
      expect(storeOnConnectSpy).not.toHaveBeenCalled();
    });

    it("commits the edge and does not toast on a valid connection", () => {
      mockNodes.push(
        makeNode("src", ["log"]),
        makeNode("dst", ["log"], ["log"]),
      );
      render(<FlowCanvas />);
      const { onConnect } = capturedReactFlowProps;

      onConnect!(makeConnection("src", "dst"));

      expect(toastErrorSpy).not.toHaveBeenCalled();
      expect(storeOnConnectSpy).toHaveBeenCalledTimes(1);
    });

    it("ignores self-connections silently (no toast, no commit)", () => {
      mockNodes.push(makeNode("src", ["log"], ["log"]));
      render(<FlowCanvas />);
      const { onConnect } = capturedReactFlowProps;

      onConnect!(makeConnection("src", "src"));

      expect(toastErrorSpy).not.toHaveBeenCalled();
      expect(storeOnConnectSpy).not.toHaveBeenCalled();
    });
  });
});
