// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, it, expect, vi } from "vitest";

const updatePipelineVariableMock = vi.fn();

vi.mock("@/stores/flow-store", () => ({
  useFlowStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      pipelineVariables: { index_name: "app-logs" },
      updatePipelineVariable: updatePipelineVariableMock,
    }),
  ),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    variable: {
      list: {
        queryOptions: () => ({
          queryKey: ["variable", "list"],
          queryFn: () => [],
          enabled: true,
        }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => ({ data: [], isLoading: false, isPending: false, isError: false }),
  };
});

describe("VariablePickerInput", () => {
  afterEach(() => {
    cleanup();
    updatePipelineVariableMock.mockReset();
  });

  it("shows selected VAR ref as badge", async () => {
    const { VariablePickerInput } = await import("../variable-picker-input");

    render(
      <VariablePickerInput
        value="VAR[index_name]"
        onChange={vi.fn()}
        environmentId="env-1"
      />,
    );

    expect(screen.getByText(/VAR\[index_name\]/)).toBeInTheDocument();
  });

  it("shows variable picker button when no var selected", async () => {
    const { VariablePickerInput } = await import("../variable-picker-input");

    render(
      <VariablePickerInput
        value="some-value"
        onChange={vi.fn()}
        environmentId="env-1"
      />,
    );

    expect(screen.getByTitle("Insert variable reference")).toBeInTheDocument();
  });
});
