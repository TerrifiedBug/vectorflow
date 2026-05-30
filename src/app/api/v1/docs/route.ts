import { NextResponse } from "next/server";
import { auth } from "@/auth";

const SWAGGER_UI_VERSION = "5.21.0";
const CDN_HOST = "cdn.jsdelivr.net";

// Subresource Integrity hashes pinning the exact bytes of the pinned
// swagger-ui-dist@5.21.0 assets. If jsdelivr ever serves tampered content for
// these paths (CDN/package takeover, BGP/DNS hijack, yank-and-republish), the
// browser refuses to execute/apply the asset. Regenerate if SWAGGER_UI_VERSION
// changes:
//   curl -sL https://cdn.jsdelivr.net/npm/swagger-ui-dist@<ver>/<file> \
//     | openssl dgst -sha384 -binary | openssl base64 -A
const SWAGGER_UI_BUNDLE_SRI =
  "sha384-sVLSl7HyCV1nd7RZmv/iLgSAiKQD9VfnzE0//SWrbZUtoVy2sPhQuAHF5hNCpDp7";
const SWAGGER_UI_CSS_SRI =
  "sha384-WoOxtFhjrhn23jYeguEcSJkYdgSIer0UxZkoMKKEqROW+TDEmHEPwckfxWmZXSIw";

const CSP = [
  "default-src 'self'",
  `script-src ${CDN_HOST} 'unsafe-inline'`,
  `style-src ${CDN_HOST} 'unsafe-inline'`,
  `img-src data: ${CDN_HOST}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

function buildSwaggerHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VectorFlow API v1 — Documentation</title>
  <link rel="stylesheet" href="https://${CDN_HOST}/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" integrity="${SWAGGER_UI_CSS_SRI}" crossorigin="anonymous" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://${CDN_HOST}/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" integrity="${SWAGGER_UI_BUNDLE_SRI}" crossorigin="anonymous"></script>
  <script>
    SwaggerUIBundle({
      url: "${specUrl}",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: "BaseLayout",
    });
  </script>
</body>
</html>`;
}

/**
 * GET /api/v1/docs
 *
 * Serves Swagger UI pointing at the OpenAPI spec.
 * Requires a valid NextAuth session (logged-in users only).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const baseUrl = (process.env.NEXTAUTH_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  const specUrl = `${baseUrl}/api/v1/openapi.json`;

  return new NextResponse(buildSwaggerHtml(specUrl), {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "Content-Security-Policy": CSP,
    },
  });
}
