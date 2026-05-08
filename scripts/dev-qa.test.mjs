import { describe, expect, test } from "vitest";
import {
  buildPrerequisiteFailureMessage,
  buildQaDevEnv,
  getQaDatabaseMode,
  getQaDatabaseUrl,
  POSTGRES_REACHABILITY_TIMEOUT_MS,
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

  test("uses a longer Postgres reachability timeout for managed endpoints", () => {
    expect(POSTGRES_REACHABILITY_TIMEOUT_MS).toBe(5000);
  });

  test("enables trusted proxy headers for the local auth bypass", () => {
    const env = buildQaDevEnv(
      { NODE_ENV: "development" },
      "postgresql://qa",
      { id: "qa-user", email: "qa@example.test", name: "QA User" },
    );
    expect(env.DEV_AUTH_BYPASS).toBe("1");
    expect(env.VF_TRUST_PROXY_HEADERS).toBe("true");
    expect(env.NEXTAUTH_URL).toBe("http://localhost:3000");
  });

  test("preserves an explicit PORT override in the QA env", () => {
    const env = buildQaDevEnv(
      { NODE_ENV: "development", PORT: "3001" },
      "postgresql://qa",
      { id: "qa-user", email: "qa@example.test", name: "QA User" },
    );
    expect(env.PORT).toBe("3001");
  });
});