import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateOpenAPISpec } from "@/app/api/v1/_lib/openapi-spec";

// Cache the serialized spec at module level so repeated requests are cheap
let _specJson: string | null = null;

function getSpecJson(): string {
  if (!_specJson) {
    _specJson = JSON.stringify(generateOpenAPISpec(), null, 2);
  }
  return _specJson;
}

/**
 * GET /api/v1/openapi.json
 *
 * Returns the VectorFlow OpenAPI 3.1 specification as JSON.
 * Requires a valid NextAuth session (logged-in users only).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new NextResponse(getSpecJson(), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
