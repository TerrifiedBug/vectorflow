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
 * short-circuit. The streaming client (`httpBatchStreamLink`) parses
 * `{ error: { json: { message, code, data: { code, ... } } } }` — anything
 * else looks like a transport-layer parse error. We mirror the shape tRPC
 * itself produces for the equivalent in-band throw so `err.data.code`
 * works the same way on the client whether the 423 came from this
 * short-circuit or from a `responseMeta` override.
 */
function trpcErrorEnvelope(opts: {
  code: "FORBIDDEN" | "NOT_FOUND";
  message: string;
  httpStatus: number;
}): string {
  return JSON.stringify({
    error: {
      json: {
        message: opts.message,
        code: -32603, // tRPC's generic internal error code (overridden by data.code)
        data: {
          code: opts.code,
          httpStatus: opts.httpStatus,
          stack: undefined,
          path: undefined,
        },
      },
    },
  });
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
  // request returns 404. The route-level short-circuit is the simplest way
  // to produce the right HTTP status on non-streaming clients
  // (httpLink / httpBatchLink), where the response body is a single
  // tRPC error envelope.
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
    if (lifecycle.deleted) {
      return new Response(
        trpcErrorEnvelope({
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