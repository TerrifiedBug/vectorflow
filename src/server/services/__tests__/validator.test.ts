import { describe, it, expect } from "vitest";
import { stubManagedSinkPlaceholders } from "@/server/services/validator";

// The VectorFlow Lake sink emits `LAKE[...]` credential placeholders that are
// resolved with real values only at delivery. `vector validate` parses the
// ClickHouse `endpoint` as a URI, so a literal `LAKE[endpoint]` panics with
// "invalid authority: IdnaError". stubManagedSinkPlaceholders swaps the refs
// for syntactically-valid stand-ins so deploy-time validation checks structure.
describe("stubManagedSinkPlaceholders", () => {
  it("replaces the lake sink endpoint placeholder with a valid URL", () => {
    const out = stubManagedSinkPlaceholders("    endpoint: LAKE[endpoint]\n");
    expect(out).toContain("endpoint: http://localhost:8123");
    expect(out).not.toContain("LAKE[");
  });

  it("replaces remaining LAKE[...] credential placeholders with a non-empty token", () => {
    const yaml = [
      "    database: LAKE[database]",
      "      user: LAKE[user]",
      "      password: LAKE[password]",
    ].join("\n");
    const out = stubManagedSinkPlaceholders(yaml);
    expect(out).not.toContain("LAKE[");
    expect(out).toContain("database: vf_lake_validate");
    expect(out).toContain("user: vf_lake_validate");
    expect(out).toContain("password: vf_lake_validate");
  });

  it("leaves configs without managed-sink placeholders untouched", () => {
    const yaml = "sinks:\n  s:\n    type: console\n    inputs: [in]\n";
    expect(stubManagedSinkPlaceholders(yaml)).toBe(yaml);
  });
});
