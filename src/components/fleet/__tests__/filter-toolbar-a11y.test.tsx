// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DeploymentMatrixToolbar } from "../DeploymentMatrixToolbar";
import { FleetListToolbar } from "../fleet-list-toolbar";

describe("fleet filter toolbars", () => {
  it("exposes pressed state on fleet status filters", () => {
    const { getByRole } = render(
      <FleetListToolbar
        search=""
        onSearchChange={vi.fn()}
        statusFilter={["HEALTHY"]}
        onStatusFilterChange={vi.fn()}
        labelFilter={{}}
        onLabelFilterChange={vi.fn()}
        availableLabels={{}}
      />
    );

    expect(getByRole("group", { name: "Fleet status filters" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Healthy" })).toHaveAttribute("aria-pressed", "true");
    expect(getByRole("button", { name: "Degraded" })).toHaveAttribute("aria-pressed", "false");
  });

  it("exposes pressed state on deployment matrix status filters and exception toggle", () => {
    const { getByRole } = render(
      <DeploymentMatrixToolbar
        search=""
        onSearchChange={vi.fn()}
        statusFilter={["Running"]}
        onStatusFilterChange={vi.fn()}
        tagFilter={[]}
        onTagFilterChange={vi.fn()}
        availableTags={[]}
        exceptionsOnly
        onExceptionsOnlyChange={vi.fn()}
      />
    );

    expect(getByRole("group", { name: "Deployment status filters" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Running" })).toHaveAttribute("aria-pressed", "true");
    expect(getByRole("button", { name: "Stopped" })).toHaveAttribute("aria-pressed", "false");
    expect(getByRole("button", { name: "Show exceptions only" })).toHaveAttribute("aria-pressed", "true");
  });
});
