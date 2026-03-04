import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/router";
import { createContext } from "@/trpc/init";

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
  });
};

export { handler as GET, handler as POST };
