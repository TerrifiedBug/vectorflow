import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks (available inside vi.mock factories) ──────────
const { mockCollectMetrics, mockAuthenticateApiKey } = vi.hoisted(() => ({
  mockCollectMetrics: vi.fn(),
  mockAuthenticateApiKey: vi.fn(),
}));

// ── Mock PrometheusMetricsService ───────────────────────────────
vi.mock("@/server/services/prometheus-metrics", () => ({
  PrometheusMetricsService: class {
    collectMetrics = mockCollectMetrics;
  },
}));

// ── Mock authenticateApiKey ─────────────────────────────────────
vi.mock("@/server/middleware/api-auth", () => ({
  authenticateApiKey: (...args: unknown[]) => mockAuthenticateApiKey(...args),
}));

import { GET } from "@/app/api/metrics/route";

// ─── Helpers ────────────────────────────────────────────────────

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/metrics", {
    method: "GET",
    headers: headers ?? {},
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe("GET /api/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth not required
    delete process.env.METRICS_AUTH_REQUIRED;
  });

  it("returns metrics with correct content type when auth disabled (default)", async () => {
    const metricsOutput = '# HELP vectorflow_node_status Node status\nvectorflow_node_status{node_id="n1"} 1\n';
    mockCollectMetrics.mockResolvedValue(metricsOutput);

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    const body = await response.text();
    expect(body).toBe(metricsOutput);
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled();
  });

  it("does not require auth header when METRICS_AUTH_REQUIRED is unset", async () => {
    mockCollectMetrics.mockResolvedValue("");

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled();
  });

  it("returns 401 when auth required and no token provided", async () => {
    process.env.METRICS_AUTH_REQUIRED = "true";
    mockAuthenticateApiKey.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain("Unauthorized");
    expect(mockAuthenticateApiKey).toHaveBeenCalledWith(null);
  });

  it("returns 401 when auth required and invalid token provided", async () => {
    process.env.METRICS_AUTH_REQUIRED = "true";
    mockAuthenticateApiKey.mockResolvedValue(null);

    const response = await GET(
      makeRequest({ Authorization: "Bearer invalid_token" }),
    );

    expect(response.status).toBe(401);
    expect(mockAuthenticateApiKey).toHaveBeenCalledWith("Bearer invalid_token");
  });

  it("returns metrics when auth required and valid token provided", async () => {
    process.env.METRICS_AUTH_REQUIRED = "true";
    mockAuthenticateApiKey.mockResolvedValue({
      serviceAccountId: "sa-1",
      serviceAccountName: "prom-scraper",
      environmentId: "env-1",
      permissions: ["read"],
    });
    mockCollectMetrics.mockResolvedValue("vectorflow_node_status 1\n");

    const response = await GET(
      makeRequest({ Authorization: "Bearer vf_valid_token" }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("vectorflow_node_status 1\n");
  });

  it("returns 500 when collectMetrics throws", async () => {
    mockCollectMetrics.mockRejectedValue(new Error("Service crash"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("Internal Server Error");

    consoleSpy.mockRestore();
  });
});
