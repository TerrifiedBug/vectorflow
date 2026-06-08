import { resolveSpEndpoints, generateSamlSpMetadata } from "@/server/services/auth/saml";

// node-saml uses Node crypto + xmldom; never bundle this on the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SAML SP metadata for this org's subdomain. Describes our EntityID and
 * Assertion Consumer Service so an IdP admin can register the SP. Public and
 * IdP-independent — safe to serve before the org has pasted its IdP cert.
 */
export function GET(request: Request): Response {
  const xml = generateSamlSpMetadata(resolveSpEndpoints(request));
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/samlmetadata+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
