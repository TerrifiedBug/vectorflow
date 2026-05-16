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

  // §12.2: a suspended-org request returns HTTP 423 Locked. A deleted-org
  // request returns 404. The route-level short-circuit produces the right
  // HTTP status on non-streaming clients (httpLink / httpBatchLink). The
  // response body is batch-aware: a single envelope for `httpLink`, an
  // array of one envelope per procedure for `?batch=1` requests.
  //
  // Streaming clients (httpBatchStreamLink, `trpc-accept: application/jsonl`)
  // send a JSON-Lines stream with per-procedure entries keyed by batch
  // index. Synthesising a JSONL body that the streaming consumer accepts
  // is brittle (the format is internal to `jsonlStreamProducer`) and a
  // 423 outer status would mis-match the per-procedure errors inside the
  // stream anyway. For streaming requests we therefore let
  // `fetchRequestHandler` run normally; `orgProcedure` throws the
  // FORBIDDEN/NOT_FOUND TRPCError for each procedure and the stream
  // delivers it in-band at HTTP 200. The client reads
  // `error.data.code === "FORBIDDEN"` either way \u2014 only the outer HTTP
  // status differs between the two link kinds.
  const isStreaming = req.headers.get("trpc-accept") === "application/jsonl";
  if (!isStreaming) {
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
        { status: 423, headers: { "Content-Type": "application/json" } },
      );
    }
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