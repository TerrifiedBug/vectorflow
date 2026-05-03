// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { VectorComponentDef } from "@/lib/vector/types";
import { useFlowStore } from "@/stores/flow-store";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  useFlowStore.getState().clearGraph();
  mockSharedComponents = [];
  document.querySelectorAll(".react-flow").forEach((node) => node.remove());
});

// ── External dependency mocks ──────────────────────────────────────────────

// ComponentPalette calls useEnvironmentStore() without a selector
vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: () => ({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    sharedComponent: {
      list: {
        queryOptions: vi.fn(() => ({
          queryKey: ["sharedComponent", "list"],
          queryFn: () => Promise.resolve([]),
        })),
      },
    },
  }),
}));

let mockSharedComponents: Array<{
  id: string;
  name: string;
  componentType: string;
  kind: string;
  config: Record<string, unknown>;
  version: number;
  linkedPipelineCount: number;
}> = [];

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockSharedComponents, isLoading: false }),
}));

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({
      x: x - 280,
      y: y - 40,
    }),
  }),
}));

// ── Catalog mock ───────────────────────────────────────────────────────────
// Keep a small, deterministic catalog so search assertions are predictable.
const MOCK_CATALOG: VectorComponentDef[] = [
  {
    type: "kafka",
    kind: "source",
    displayName: "Apache Kafka",
    description: "Read from a Kafka topic",
    category: "Messaging",
    icon: "default",
    configSchema: {},
    outputTypes: ["log"],
  },
  {
    type: "remap",
    kind: "transform",
    displayName: "Remap",
    description: "Transform events with VRL",
    category: "Transform",
    icon: "default",
    configSchema: {},
    inputTypes: ["log"],
    outputTypes: ["log"],
  },
  {
    type: "datadog_logs",
    kind: "sink",
    displayName: "Datadog Logs",
    description: "Send logs to Datadog",
    category: "Observability",
    icon: "default",
    configSchema: {},
    inputTypes: ["log"],
    outputTypes: [],
  },
];

vi.mock("@/lib/vector/catalog", () => ({
  getVectorCatalog: () => MOCK_CATALOG,
}));

// Mock via the alias path (resolves to src/components/flow/node-icon)
vi.mock("@/components/flow/node-icon", () => ({
  getIcon: () => () => <span data-testid="icon" />,
}));

import { ComponentPalette } from "../component-palette";

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ComponentPalette", () => {
  describe("search filtering", () => {
    it("renders all catalog components when search is empty", () => {
      const { getByText } = render(<ComponentPalette />);
      expect(getByText("Apache Kafka")).toBeTruthy();
      expect(getByText("Remap")).toBeTruthy();
      expect(getByText("Datadog Logs")).toBeTruthy();
    });

    it("filters components by display name", () => {
      const { getByPlaceholderText, getByText, queryByText } = render(
        <ComponentPalette />
      );
      const input = getByPlaceholderText("Search components...");
      fireEvent.change(input, { target: { value: "kafka" } });

      expect(getByText("Apache Kafka")).toBeTruthy();
      expect(queryByText("Remap")).toBeNull();
      expect(queryByText("Datadog Logs")).toBeNull();
    });

    it("shows empty state message when search matches nothing", () => {
      const { getByPlaceholderText, getByText } = render(<ComponentPalette />);
      const input = getByPlaceholderText("Search components...");
      fireEvent.change(input, { target: { value: "xyzzy_no_match" } });

      expect(getByText("No components match your search.")).toBeTruthy();
    });

    it("filters components by description text", () => {
      const { getByPlaceholderText, getByText, queryByText } = render(
        <ComponentPalette />
      );
      const input = getByPlaceholderText("Search components...");
      fireEvent.change(input, { target: { value: "VRL" } });

      expect(getByText("Remap")).toBeTruthy();
      expect(queryByText("Apache Kafka")).toBeNull();
    });
  });

  describe("tab switching", () => {
    it("renders 'Catalog' and 'Shared' tabs", () => {
      const { getByText } = render(<ComponentPalette />);
      expect(getByText("Catalog")).toBeTruthy();
      expect(getByText("Shared")).toBeTruthy();
    });

    it("exposes selected state for palette tabs", () => {
      const { getByRole } = render(<ComponentPalette />);

      expect(getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(getByRole("tab", { name: "Shared" })).toHaveAttribute(
        "aria-selected",
        "false"
      );

      fireEvent.click(getByRole("tab", { name: "Shared" }));

      expect(getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "false"
      );
      expect(getByRole("tab", { name: "Shared" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    });

    it("switches to Shared tab when clicked", () => {
      const { getByText, queryByText } = render(<ComponentPalette />);
      fireEvent.click(getByText("Shared"));

      // When on the Shared tab, catalog items should not be visible
      expect(queryByText("Apache Kafka")).toBeNull();
    });

    it("switches back to Catalog tab after clicking Catalog", () => {
      const { getByText } = render(<ComponentPalette />);
      fireEvent.click(getByText("Shared"));
      fireEvent.click(getByText("Catalog"));

      expect(getByText("Apache Kafka")).toBeTruthy();
    });
  });

  describe("drag initiation", () => {
    it("sets correct dataTransfer data on drag start of a catalog component", () => {
      const { getByText } = render(<ComponentPalette />);
      const item = getByText("Apache Kafka").closest("[draggable]") as HTMLElement;
      expect(item).toBeTruthy();

      const dataTransferData: Record<string, string> = {};
      const mockDataTransfer = {
        setData: (key: string, value: string) => {
          dataTransferData[key] = value;
        },
        effectAllowed: "",
      };

      fireEvent.dragStart(item, { dataTransfer: mockDataTransfer });

      expect(dataTransferData["application/vectorflow-component"]).toBe(
        "source:kafka"
      );
    });
  });

  describe("keyboard add actions", () => {
    it("adds a catalog component to the canvas center via the flow store", () => {
      const { getByRole } = render(<ComponentPalette />);
      document.querySelector(".react-flow")?.remove();
      const canvas = document.createElement("div");
      canvas.className = "react-flow";
      canvas.getBoundingClientRect = () =>
        ({
          left: 280,
          top: 40,
          width: 800,
          height: 600,
          right: 1080,
          bottom: 640,
          x: 280,
          y: 40,
          toJSON: () => ({}),
        }) as DOMRect;
      document.body.appendChild(canvas);

      fireEvent.click(getByRole("button", { name: "Add Apache Kafka to canvas" }));

      const node = useFlowStore.getState().nodes[0];
      expect(node.data.componentDef).toMatchObject({
        kind: "source",
        type: "kafka",
      });
      expect(node.position).toEqual({ x: 400, y: 300 });

      canvas.remove();
    });

    it("adds a shared component with link metadata and filter pressed state", () => {
      mockSharedComponents = [
        {
          id: "shared-1",
          name: "Shared Kafka",
          componentType: "kafka",
          kind: "SOURCE",
          config: { topic: "logs" },
          version: 3,
          linkedPipelineCount: 2,
        },
      ];
      const { getByRole } = render(<ComponentPalette />);

      fireEvent.click(getByRole("tab", { name: "Shared" }));
      expect(getByRole("button", { name: "All" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      fireEvent.click(getByRole("button", { name: "Source" }));
      expect(getByRole("button", { name: "Source" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );

      fireEvent.click(getByRole("button", { name: "Add Shared Kafka to canvas" }));

      const node = useFlowStore.getState().nodes[0];
      expect(node.data).toMatchObject({
        sharedComponentId: "shared-1",
        sharedComponentName: "Shared Kafka",
        sharedComponentVersion: 3,
        sharedComponentLatestVersion: 3,
        config: { topic: "logs" },
      });
    });
  });
});
