import { vi, describe, it, expect, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    isLakeEnabled: vi.fn(),
    isLakeColdTierEnabled: vi.fn(),
    getLakeConfig: vi.fn(),
    command: vi.fn(),
  },
}));

vi.mock("@/server/services/lake/clickhouse", () => ({
  isLakeEnabled: mocks.isLakeEnabled,
  isLakeColdTierEnabled: mocks.isLakeColdTierEnabled,
  getLakeConfig: mocks.getLakeConfig,
  getLakeClient: () => ({ command: mocks.command }),
}));

import { runLakeMigrations } from "../migrate";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLakeConfig.mockReturnValue({ database: "vectorflow_lake" });
  mocks.command.mockResolvedValue(undefined);
});

function allSql(): string {
  return mocks.command.mock.calls.map((c) => (c[0] as { query: string }).query).join("\n;;\n");
}

describe("runLakeMigrations", () => {
  it("no-ops when the lake is disabled (never connects)", async () => {
    mocks.isLakeEnabled.mockReturnValue(false);

    const result = await runLakeMigrations();

    expect(result).toEqual({ skipped: true, files: 0, statements: 0 });
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("creates the database and applies lake_events (hot-only TTL, no storage policy)", async () => {
    mocks.isLakeEnabled.mockReturnValue(true);
    mocks.isLakeColdTierEnabled.mockReturnValue(false);

    const result = await runLakeMigrations();

    expect(result.skipped).toBe(false);
    expect(result.files).toBeGreaterThanOrEqual(1);
    expect(result.statements).toBeGreaterThanOrEqual(1); // lake_events CREATE TABLE (CREATE DATABASE is issued separately)
    expect(mocks.command.mock.calls.length).toBeGreaterThanOrEqual(2); // CREATE DATABASE + CREATE TABLE
    const sql = allSql();
    expect(sql).toContain("CREATE DATABASE IF NOT EXISTS vectorflow_lake");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS vectorflow_lake.lake_events");
    expect(sql).toContain("INTERVAL 90 DAY DELETE");
    // hot-only must NOT move to cold or set a storage policy
    expect(sql).not.toContain("TO VOLUME 'cold'");
    expect(sql).not.toContain("storage_policy");
    // template tokens must be fully expanded
    expect(sql).not.toContain("{database}");
    expect(sql).not.toContain("{ttl}");
  });

  it("applies hot->cold tiering + storage policy when the cold tier is enabled", async () => {
    mocks.isLakeEnabled.mockReturnValue(true);
    mocks.isLakeColdTierEnabled.mockReturnValue(true);

    await runLakeMigrations();

    const sql = allSql();
    expect(sql).toContain("INTERVAL 7 DAY TO VOLUME 'cold'");
    expect(sql).toContain("INTERVAL 90 DAY DELETE");
    expect(sql).toContain("storage_policy = 'vf_hot_cold'");
  });
});
