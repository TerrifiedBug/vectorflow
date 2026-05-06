// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const queryState = vi.hoisted(() => ({
  value: {
    data: [],
    isError: false,
    isPending: false,
    isSuccess: true,
    error: null,
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.value,
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    anomaly: {
      list: {
        queryOptions: vi.fn(() => ({ queryKey: ["anomalies"], queryFn: vi.fn() })),
      },
    },
  }),
}));

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: () => ({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/components/ui/date-range-picker", () => ({
  DateRangePicker: () => <button type="button">Incident window</button>,
}));

vi.mock("@/components/motion", () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import IncidentsPage from "../page";

describe("IncidentsPage", () => {
  afterEach(() => {
    cleanup();
    queryState.value = {
      data: [],
      isError: false,
      isPending: false,
      isSuccess: true,
      error: null,
    };
  });

  it("scopes page copy to anomaly-only data", () => {
    render(<IncidentsPage />);

    expect(screen.getByRole("heading", { name: /anomaly timeline/i })).toBeInTheDocument();
    expect(screen.getByText(/no anomalies detected in the selected window/i)).toBeInTheDocument();
    expect(screen.queryByText("DEPLOYS · 14H")).not.toBeInTheDocument();
    expect(screen.queryByText(/deploys/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rollbacks/i)).not.toBeInTheDocument();
  });

  it("shows loading skeleton instead of empty state while anomalies are loading", () => {
    queryState.value = {
      data: undefined,
      isError: false,
      isPending: true,
      isSuccess: false,
      error: null,
    };

    render(<IncidentsPage />);

    expect(screen.getByText(/loading anomaly timeline/i)).toBeInTheDocument();
    expect(screen.queryByText(/no anomalies detected in the selected window/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pipeline ·/i)).not.toBeInTheDocument();
  }); 
});
