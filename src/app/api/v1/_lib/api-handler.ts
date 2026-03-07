import { NextRequest, NextResponse } from "next/server";
import {
  authenticateApiKey,
  hasPermission,
  type ServiceAccountContext,
} from "@/server/middleware/api-auth";

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
      console.error("[api-handler] unhandled error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
