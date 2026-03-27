import { NextResponse } from "next/server";
import { generateOpenAPISpec } from "@/app/api/v1/_lib/openapi-spec";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
 * Public endpoint (no auth required) — returns the VectorFlow OpenAPI 3.1
 * specification as JSON. CORS headers allow external tooling (Swagger UI,
 * Postman, etc.) to fetch the spec without credentials.
 */
export function GET() {
  return new NextResponse(getSpecJson(), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

/**
 * OPTIONS /api/v1/openapi.json
 *
 * CORS preflight handler.
 */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
