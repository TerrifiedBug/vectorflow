// src/app/api/agent/config/__tests__/config-rate-limit.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/app/api/_lib/ip-rate-limit", () => ({
  checkTokenRateLimit: vi.fn(() => Promise.resolve(null)),
  checkIpRateLimit: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgent: vi.fn(() =>
    Promise.resolve({ nodeId: "node-1", environmentId: "env-1" }),
  ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vectorNode: {
      findUnique: vi.fn(() =>
        Promise.resolve({ pendingAction: null, maintenanceMode: false, labels: {} }),
      ),
    },
    environment: {
      findUnique: vi.fn(() =>
        Promise.resolve({ id: "env-1", secretBackend: "BUILTIN", secretBackendConfig: null }),
      ),
    },
    pipeline: { findMany: vi.fn(() => Promise.resolve([])) },
    eventSampleRequest: { findMany: vi.fn(() => Promise.resolve([])) },
    systemSettings: {
      findUnique: vi.fn(() => Promise.resolve({ fleetPollIntervalMs: 15000 })),
    },
  },
}));

vi.mock("@/server/services/secret-resolver", () => ({
  collectSecretRefs: vi.fn(() => []),
  convertSecretRefsToEnvVars: vi.fn((c: unknown) => c),
  resolveCertRefs: vi.fn((c: unknown) => ({ config: c, certFiles: [] })),
  secretNameToEnvVar: vi.fn((n: string) => `VF_SECRET_${n.toUpperCase()}`),
}));

vi.mock("@/server/services/crypto", () => ({
  decrypt: vi.fn((v: string) => v),
}));

vi.mock("@/server/services/drift-metrics", () => ({
  setExpectedChecksum: vi.fn(),
}));

import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";

describe("GET /api/agent/config — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls checkTokenRateLimit with endpoint 'config' and limit 30", async () => {
    const { GET } = await import("@/app/api/agent/config/route");

    const request = new Request("http://localhost/api/agent/config", {
      method: "GET",
      headers: { authorization: "Bearer test-node-token" },
    });

    await GET(request);

    expect(checkTokenRateLimit).toHaveBeenCalledWith(request, "config", 30);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    vi.mocked(checkTokenRateLimit).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
      }),
    );

    const { GET } = await import("@/app/api/agent/config/route");

    const request = new Request("http://localhost/api/agent/config", {
      method: "GET",
      headers: { authorization: "Bearer test-node-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(429);
  });
});
