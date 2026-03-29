import { NextResponse } from "next/server";
import { auth } from "@/auth";

const SWAGGER_UI_VERSION = "5.21.0";
const CDN_HOST = "cdn.jsdelivr.net";

const CSP = [
  "default-src 'self'",
  `script-src ${CDN_HOST} 'unsafe-inline'`,
  `style-src ${CDN_HOST} 'unsafe-inline'`,
  `img-src data: ${CDN_HOST}`,
].join("; ");

function buildSwaggerHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VectorFlow API v1 — Documentation</title>
  <link rel="stylesheet" href="https://${CDN_HOST}/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://${CDN_HOST}/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
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

  const url = new URL(request.url);
  const specUrl = `${url.protocol}//${url.host}/api/v1/openapi.json`;

  return new NextResponse(buildSwaggerHtml(specUrl), {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "Content-Security-Policy": CSP,
    },
  });
}
