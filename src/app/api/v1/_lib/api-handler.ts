import { NextRequest, NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  authenticateApiKey,
  hasPermission,
  type ServiceAccountContext,
} from "@/server/middleware/api-auth";

/** BigInt-safe NextResponse.json() — converts BigInts to numbers before serialization. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonResponse(data: any, init?: { status?: number }) {
  const body = JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? Number(value) : value,
  );
  return new NextResponse(body, {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

const TRPC_TO_HTTP: Record<string, number> = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
};

export function apiRoute(
  permission: string,
  handler: (
    req: NextRequest,
    ctx: ServiceAccountContext,
    params?: Record<string, string>,
  ) => Promise<NextResponse>,
) {
  return async (
    req: NextRequest,
    { params }: { params?: Promise<Record<string, string>> },
  ) => {
    const auth = req.headers.get("authorization");
    const ctx = await authenticateApiKey(auth);
    if (!ctx)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasPermission(ctx, permission))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
      const resolvedParams = params ? await params : undefined;
      return await handler(req, ctx, resolvedParams);
    } catch (err) {
      if (err instanceof TRPCError) {
        const status = TRPC_TO_HTTP[err.code] ?? 500;
        return NextResponse.json({ error: err.message }, { status });
      }
      console.error("[api-handler] unhandled error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
