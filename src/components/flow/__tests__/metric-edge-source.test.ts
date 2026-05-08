import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const metricEdgeSource = readFileSync("src/components/flow/metric-edge.tsx", "utf8");

describe("metric edge DOM props", () => {
  it("does not spread raw React Flow edge props onto DOM-backed edge elements", () => {
    expect(metricEdgeSource).not.toContain("{...props}");
  });
});
