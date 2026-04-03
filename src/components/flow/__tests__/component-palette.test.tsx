// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { VectorComponentDef } from "@/lib/vector/types";

afterEach(cleanup);

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

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
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
});
