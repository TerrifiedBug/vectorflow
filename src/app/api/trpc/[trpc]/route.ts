export const runtime = "nodejs";

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/router";
import {
  createContext,
  OrgSuspendedError,
  isCallerOrgSuspended,
} from "@/trpc/init";

/**
 * Build a tRPC-superjson-shaped error envelope for the route-level
 * short-circuit. The shape must match what the client expects from
 * `fetchRequestHandler` for both link kinds:
 *
 *   - `httpLink` (single call):
 *       `{ error: { json: { message, code, data: { code, httpStatus, ... } } } }`
 *   - `httpBatchLink` (URL has `?batch=1`):
 *       `[ { error: { json: { ... } } }, { error: { json: { ... } } }, ... ]`
 *       — one entry per procedure path in the comma-separated URL.
 *
 * Streaming (`httpBatchStreamLink`, `trpc-accept: application/jsonl`) is
 * NOT handled here \u2014 see the comment in `handler` below.
 */
function trpcErrorEnvelope(opts: {
  url: URL;
  code: "FORBIDDEN" | "NOT_FOUND";
  message: string;
  httpStatus: number;
}): string {
  // JSON-RPC numeric code maps `FORBIDDEN` \u2192 -32001 and `NOT_FOUND` \u2192
  // -32004 in tRPC\'s error formatter. Hard-coding `-32603` (internal
  // error) would let tooling that keys on the numeric code mis-classify
  // these as 5xx faults; mirror tRPC\'s mapping instead.
  const jsonRpcCode = opts.code === "NOT_FOUND" ? -32004 : -32001;
  const oneEntry = {
    error: {
      json: {
        message: opts.message,
        code: jsonRpcCode,
        data: {
          code: opts.code,
          httpStatus: opts.httpStatus,
          stack: undefined,
          path: undefined,
        },
      },
    },
  };
  // Detect batch mode and emit an array entry per procedure path. The
  // path lives in the last segment of the URL: `/api/trpc/proc1,proc2`.
  const batch = opts.url.searchParams.get("batch") === "1";
  if (!batch) {
    return JSON.stringify(oneEntry);
  }
  const procPath = opts.url.pathname.split("/").pop() ?? "";
  const count = Math.max(1, procPath.split(",").length);
  return JSON.stringify(Array.from({ length: count }, () => oneEntry));
}

const handler = async (req: Request) => {
  // CSRF protection: POST (mutation) requests must include x-trpc-source header
  if (req.method === "POST" && req.headers.get("x-trpc-source") !== "client") {
    return new Response(JSON.stringify({ error: "Missing CSRF header" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Every request hits the lifecycle gate, streaming or not.
  // Producing the *right body shape* for `httpBatchStreamLink` after the
  // fact is impractical \u2014 the JSONL framing is internal to
  // `jsonlStreamProducer` and a HTTP 423 / 404 outer status would
  // mismatch a per-procedure error inside the stream anyway. The
  // compromise:
  //
  //   - Non-streaming clients (httpLink, httpBatchLink) get the
  //     batch-aware tRPC error envelope produced by `trpcErrorEnvelope`,
  //     with the right outer HTTP status (404 / 423).
  //   - Streaming clients (httpBatchStreamLink, `trpc-accept:
  //     application/jsonl`) get the same outer HTTP status (404 / 423)
  //     and the same non-JSONL body. The streaming consumer will treat
  //     the response as a transport failure; the HTTP status is what
  //     the client / monitoring tooling keys on, and the user-visible
  //     UX (an HTTP-error toast, "Service unavailable") is appropriate
  //     for a suspended tenant.
  //
  // Either way the request NEVER reaches `fetchRequestHandler` for a
  // suspended / deleted org. The lifecycle check is the gate \u2014 NOT
  // `responseMeta` (which only fires on non-streaming) and NOT the
  // orgProcedure throw (which fires inside the stream at HTTP 200).
  const lifecycle = await isCallerOrgSuspended();
  const reqUrl = new URL(req.url);
  if (lifecycle.deleted) {
    return new Response(
      trpcErrorEnvelope({
        url: reqUrl,
        code: "NOT_FOUND",
        message: "Organization not found",
        httpStatus: 404,
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
  if (lifecycle.suspended) {
    return new Response(
      trpcErrorEnvelope({
        url: reqUrl,
        code: "FORBIDDEN",
        message: "Organization is suspended",
        httpStatus: 423,
      }),
      {
        status: 423,
        headers: {
          "Content-Type": "application/json",
          // Plan \u00a712.2 retry hint, parallel to `agent-org-binding.ts`.
          "Retry-After": "86400",
        },
      },
    );
  }

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    responseMeta({ errors }) {
      // Belt-and-braces for the non-streaming clients: keep the original
      // `responseMeta` fallback. Either path can produce the 423; both
      // are exercised by `suspended-org-423.test.ts`.
      if (errors.some((e) => e.cause instanceof OrgSuspendedError)) {
        return { status: 423 };
      }
      return {};
    },
  });
};

export { handler as GET, handler as POST };