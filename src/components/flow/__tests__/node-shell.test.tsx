// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@xyflow/react", () => ({
  Handle: (props: Record<string, unknown>) => <div data-testid="handle" {...props} />,
  Position: { Left: "left", Right: "right" },
}));

import { NODE_DIMENSIONS, NodeShell } from "../node-shell";

describe("NodeShell", () => {
  it("keeps type and component labels at or above the 11px design floor", () => {
    const { getByText } = render(
      <NodeShell kind="source" typeLabel="SOURCE" name="Kubernetes Logs" monoName="kubernetes_logs" />,
    );

    expect(getByText("SOURCE")).toHaveStyle({ fontSize: "11px" });
    expect(getByText("kubernetes_logs")).toHaveStyle({ fontSize: "11px" });
  });

  it("uses expanded card dimensions so throughput and long names stay visible", () => {
    const { container, getByText } = render(
      <NodeShell
        kind="sink"
        typeLabel="SINK"
        name="Elasticsearch"
        monoName="elasticsearch_sink"
        throughput="4 ev/s"
      />,
    );

    expect(NODE_DIMENSIONS).toEqual({ width: 180, height: 72 });
    expect(container.querySelector('div[style*="width: 180px"][style*="height: 72px"]')).toBeTruthy();
    expect(getByText("4 ev/s")).toBeInTheDocument();
  });
});
