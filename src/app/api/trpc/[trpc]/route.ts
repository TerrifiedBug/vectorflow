export const runtime = "nodejs";

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/router";
import { createContext, OrgSuspendedError } from "@/trpc/init";

const handler = (req: Request) => {
  // CSRF protection: POST (mutation) requests must include x-trpc-source header
  if (req.method === "POST" && req.headers.get("x-trpc-source") !== "client") {
    return new Response(JSON.stringify({ error: "Missing CSRF header" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    responseMeta({ errors }) {
      // §12.2: a suspended-org tRPC call returns HTTP 423 Locked, not 403.
      // tRPC has no built-in 423 mapping, so we tag the throw with an
      // `OrgSuspendedError` cause in `orgProcedure` and override the status here.
      if (errors.some((e) => e.cause instanceof OrgSuspendedError)) {
        return { status: 423 };
      }
      return {};
    },
  });
};

export { handler as GET, handler as POST };