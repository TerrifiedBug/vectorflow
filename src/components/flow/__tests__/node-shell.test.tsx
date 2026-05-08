// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@xyflow/react", () => ({
  Handle: (props: Record<string, unknown>) => <div data-testid="handle" {...props} />,
  Position: { Left: "left", Right: "right" },
}));

import { NodeShell } from "../node-shell";

describe("NodeShell", () => {
  it("keeps type and component labels at or above the 11px design floor", () => {
    const { getByText } = render(
      <NodeShell kind="source" typeLabel="SOURCE" name="Kubernetes Logs" monoName="kubernetes_logs" />,
    );

    expect(getByText("SOURCE")).toHaveStyle({ fontSize: "11px" });
    expect(getByText("kubernetes_logs")).toHaveStyle({ fontSize: "11px" });
  });
});
