import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the ClickHouse driver — @clickhouse/client is not installed in OSS dev
// and we must never open a real connection. createClient returns a distinct
// truthy object so the globalThis-cached singleton (getLakeClient) has
// something to cache.
const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn((_opts?: unknown) => ({
    query: vi.fn(),
    insert: vi.fn(),
    command: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
  })),
}));
vi.mock("@clickhouse/client", () => ({ createClient: createClientMock }));

// Mock the centralized env so each test drives the *parsed* pool settings
// directly. The real env singleton is frozen at import, so exercising both the
// default and an override in one file would otherwise require re-importing the
// module — which the no-dynamic-import rule forbids. Mutating this hoisted
// object is the static-import-friendly equivalent. Initial values mirror the
// defaults declared in src/lib/env.ts (VF_LAKE_CH_POOL_MAX=10,
// VF_LAKE_CH_REQUEST_TIMEOUT_MS=30000).
const { envMock } = vi.hoisted(() => ({
  envMock: { VF_LAKE_CH_POOL_MAX: 10, VF_LAKE_CH_REQUEST_TIMEOUT_MS: 30000 },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { getLakeClient } from "../clickhouse";

interface CreateClientOptions {
  max_open_connections?: number;
  request_timeout?: number;
  keep_alive?: { enabled: boolean };
}

function firstCallOptions(): CreateClientOptions {
  return (createClientMock.mock.calls[0]?.[0] ?? {}) as CreateClientOptions;
}

describe("lake clickhouse connection pool", () => {
  beforeEach(() => {
    // Reset the globalThis-cached singleton + the driver mock + parsed env.
    delete (globalThis as unknown as { __vfLakeClient?: unknown }).__vfLakeClient;
    createClientMock.mockClear();
    envMock.VF_LAKE_CH_POOL_MAX = 10;
    envMock.VF_LAKE_CH_REQUEST_TIMEOUT_MS = 30000;
    process.env.VF_LAKE_CLICKHOUSE_URL = "http://clickhouse:8123";
  });

  afterEach(() => {
    delete process.env.VF_LAKE_CLICKHOUSE_URL;
  });

  it("bounds the pool with the default max_open_connections from env", () => {
    getLakeClient();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const opts = firstCallOptions();
    expect(opts.max_open_connections).toBe(10);
    expect(opts.request_timeout).toBe(30000);
    // keep_alive is set explicitly so sockets are reused across requests.
    expect(opts.keep_alive).toEqual({ enabled: true });
  });

  it("uses an overridden VF_LAKE_CH_POOL_MAX", () => {
    envMock.VF_LAKE_CH_POOL_MAX = 25;
    getLakeClient();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(firstCallOptions().max_open_connections).toBe(25);
  });

  it("caches the client — createClient runs once across two getLakeClient calls", () => {
    const first = getLakeClient();
    const second = getLakeClient();
    expect(first).toBe(second);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });
});
