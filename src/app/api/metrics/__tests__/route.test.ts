import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockCollectMetrics, mockAuthenticateApiKey } = vi.hoisted(() => ({
  mockCollectMetrics: vi.fn(),
  mockAuthenticateApiKey: vi.fn(),
}));

vi.mock("@/server/services/prometheus-metrics", () => ({
  PrometheusMetricsService: class {
    collectMetrics = mockCollectMetrics;
  },
}));

vi.mock("@/server/middleware/api-auth", () => ({
  authenticateApiKey: (...args: unknown[]) => mockAuthenticateApiKey(...args),
  hasPermission: (ctx: { permissions: string[] }, perm: string) =>
    ctx.permissions.includes(perm),
}));

import { GET } from "@/app/api/metrics/route";

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/metrics", {
    method: "GET",
    headers: headers ?? {},
  });
}

describe("GET /api/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth header provided", async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(mockAuthenticateApiKey).toHaveBeenCalledWith(null);
  });

  it("returns 401 when invalid token provided", async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    const response = await GET(
      makeRequest({ Authorization: "Bearer invalid_token" }),
    );

    expect(response.status).toBe(401);
    expect(mockAuthenticateApiKey).toHaveBeenCalledWith("Bearer invalid_token");
  });

  it("returns 401 when token lacks metrics.read permission", async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      serviceAccountId: "sa-1",
      serviceAccountName: "deploy-bot",
      environmentId: "env-1",
      permissions: ["pipelines.deploy"],
    });

    const response = await GET(
      makeRequest({ Authorization: "Bearer vf_deploy_token" }),
    );

    expect(response.status).toBe(401);
  });

  it("returns metrics when valid token provided", async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      serviceAccountId: "sa-1",
      serviceAccountName: "prom-scraper",
      environmentId: "env-1",
      permissions: ["metrics.read"],
    });
    mockCollectMetrics.mockResolvedValue("vectorflow_node_status 1\n");

    const response = await GET(
      makeRequest({ Authorization: "Bearer vf_valid_token" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    const body = await response.text();
    expect(body).toBe("vectorflow_node_status 1\n");
  });

  it("returns 500 when collectMetrics throws", async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      serviceAccountId: "sa-1",
      serviceAccountName: "prom-scraper",
      environmentId: "env-1",
      permissions: ["metrics.read"],
    });
    mockCollectMetrics.mockRejectedValue(new Error("Service crash"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      makeRequest({ Authorization: "Bearer vf_valid_token" }),
    );

    expect(response.status).toBe(500);
    consoleSpy.mockRestore();
  });
});
