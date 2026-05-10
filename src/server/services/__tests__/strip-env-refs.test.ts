import { describe, expect, it } from "vitest";
import { stripEnvRefs } from "../strip-env-refs";

describe("stripEnvRefs", () => {
  it("strips SECRET, CERT, and VAR references from nested object values", () => {
    const result = stripEnvRefs(
      {
        password: "SECRET[db-pass]",
        tls: { ca_file: "CERT[root-ca]" },
        endpoint: "VAR[endpoint]",
        headers: ["VAR[not-stripped-in-arrays]"],
      },
      "component-1",
    );

    expect(result.config).toEqual({
      password: "",
      tls: { ca_file: "" },
      endpoint: "",
      headers: ["VAR[not-stripped-in-arrays]"],
    });
    expect(result.strippedSecrets).toEqual([{ name: "db-pass", componentKey: "component-1" }]);
    expect(result.strippedCertificates).toEqual([{ name: "root-ca", componentKey: "component-1" }]);
    expect(result.strippedVariables).toEqual([{ name: "endpoint", componentKey: "component-1" }]);
  });
});
