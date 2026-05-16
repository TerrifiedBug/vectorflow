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
  // request returns 404 (per `orgProcedure`'s precedence in `init.ts`).
  // The `responseMeta` callback below catches the non-streaming case
  // (httpLink / httpBatchLink) by inspecting `errors[]` after the
  // procedure has thrown. Streaming clients (httpBatchStreamLink, which
  // is what `src/trpc/client.tsx` uses) keep HTTP status 200 and put the
  // error inside the JSON stream — `responseMeta` runs eagerly with no
  // errors present and can't override the status. To cover both client
  // shapes we short-circuit at the request boundary.
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