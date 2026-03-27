import { describe, it, expect } from "vitest";
import { nodeMatchesGroup } from "@/lib/node-group-utils";

describe("nodeMatchesGroup", () => {
  it("Test 13: Empty criteria matches any labels (returns true)", () => {
    expect(nodeMatchesGroup({ region: "us-east", role: "web" }, {})).toBe(true);
    expect(nodeMatchesGroup({}, {})).toBe(true);
  });

  it("Test 14: Criteria {region: 'us-east'} matches node with {region: 'us-east', role: 'web'} (subset match)", () => {
    expect(
      nodeMatchesGroup({ region: "us-east", role: "web" }, { region: "us-east" }),
    ).toBe(true);
  });

  it("Test 15: Criteria {region: 'us-east'} does NOT match node with {region: 'eu-west'}", () => {
    expect(
      nodeMatchesGroup({ region: "eu-west" }, { region: "us-east" }),
    ).toBe(false);
  });
});
