export const runtime = "nodejs";

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/router";
import {
  createContext,
  OrgSuspendedError,
  isCallerOrgSuspended,
} from "@/trpc/init";

const handler = async (req: Request) => {
  // CSRF protection: POST (mutation) requests must include x-trpc-source header
  if (req.method === "POST" && req.headers.get("x-trpc-source") !== "client") {
    return new Response(JSON.stringify({ error: "Missing CSRF header" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // §12.2: a suspended-org request returns HTTP 423 Locked. The
  // `responseMeta` callback below catches the non-streaming case
  // (httpLink / httpBatchLink) by inspecting `errors[]` after the
  // procedure has thrown. Streaming clients (httpBatchStreamLink, which
  // is what `src/trpc/client.tsx` uses) keep HTTP status 200 and put the
  // error inside the JSON stream — `responseMeta` runs eagerly with no
  // errors present and can't override the status. To cover both client
  // shapes we short-circuit at the request boundary: resolve the caller's
  // org once up front and, if it's suspended, return 423 directly without
  // entering tRPC's resolver pipeline at all.
  const suspended = await isCallerOrgSuspended();
  if (suspended) {
    return new Response(
      JSON.stringify({
        error: {
          code: "FORBIDDEN",
          message: "Organization is suspended",
        },
      }),
      {
        status: 423,
        headers: { "Content-Type": "application/json" },
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
      // are now exercised by `suspended-org-423.test.ts`.
      if (errors.some((e) => e.cause instanceof OrgSuspendedError)) {
        return { status: 423 };
      }
      return {};
    },
  });
};

export { handler as GET, handler as POST };