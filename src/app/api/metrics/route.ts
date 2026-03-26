import { PrometheusMetricsService } from "@/server/services/prometheus-metrics";
import { authenticateApiKey } from "@/server/middleware/api-auth";

const service = new PrometheusMetricsService();

/**
 * GET /api/metrics — Prometheus exposition format endpoint.
 *
 * Auth model (D022): unauthenticated by default.
 * Set METRICS_AUTH_REQUIRED=true to require a valid Bearer token
 * via authenticateApiKey (same as the V1 REST API).
 */
export async function GET(request: Request) {
  // ── Opt-in auth ───────────────────────────────────────────────
  const authRequired = process.env.METRICS_AUTH_REQUIRED === "true";

  if (authRequired) {
    const authHeader = request.headers.get("authorization");
    const ctx = await authenticateApiKey(authHeader);
    if (!ctx) {
      return new Response("Unauthorized\n", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  // ── Collect and return metrics ────────────────────────────────
  try {
    const metricsText = await service.collectMetrics();
    return new Response(metricsText, {
      status: 200,
      headers: {
        "Content-Type":
          "text/plain; version=0.0.4; charset=utf-8",
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
