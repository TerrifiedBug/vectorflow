import { PrometheusMetricsService } from "@/server/services/prometheus-metrics";
import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";

const service = new PrometheusMetricsService();

/**
 * GET /api/metrics — Prometheus exposition format endpoint.
 *
 * Requires a valid service account Bearer token with `metrics.read` permission.
 * Configure your Prometheus scraper with: bearer_token: "vf_<key>"
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const ctx = await authenticateApiKey(authHeader);
  if (!ctx || !hasPermission(ctx, "metrics.read")) {
    return new Response("Unauthorized\n", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const metricsText = await service.collectMetrics();
    return new Response(metricsText, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("[/api/metrics] Failed to collect metrics:", error);
    return new Response("Internal Server Error\n", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
