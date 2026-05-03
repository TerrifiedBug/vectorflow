import { describe, expect, test } from "vitest";
import {
  buildPrerequisiteFailureMessage,
  getQaDatabaseMode,
  getQaDatabaseUrl,
} from "./dev-qa-lib.mjs";

describe("dev QA database mode", () => {
  test("keeps Docker as the default database path", () => {
    expect(getQaDatabaseMode({})).toBe("docker");
  });

  test("allows local Postgres as an explicit opt-in mode", () => {
    expect(getQaDatabaseMode({ QA_DATABASE_MODE: "local-pg" })).toBe("local-pg");
  });

  test("uses the local Postgres default URL on port 5433", () => {
    expect(getQaDatabaseUrl({ QA_DATABASE_MODE: "local-pg" })).toBe(
      "postgresql://vectorflow_e2e:e2e_test_password@127.0.0.1:5433/vectorflow_e2e?schema=public",
    );
  });

  test("reports missing Docker and local Postgres prerequisites with the configured endpoint", () => {
    expect(
      buildPrerequisiteFailureMessage({
        mode: "docker",
        databaseUrl:
          "postgresql://vectorflow_e2e:e2e_test_password@127.0.0.1:6543/vectorflow_e2e?schema=public",
        dockerAvailable: false,
        localPostgresReachable: false,
      }),
    ).toContain("Docker daemon is unreachable and no PostgreSQL server is reachable at 127.0.0.1:6543");
  });
});
