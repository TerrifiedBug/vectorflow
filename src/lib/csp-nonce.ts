import { headers } from "next/headers";

import { CSP_NONCE_HEADER } from "@/lib/security-headers";

/**
 * Reads the per-request CSP nonce that `src/proxy.ts` sets on the request in
 * strict multi-tenant mode. Server-component only (uses `headers()`).
 *
 * Returns `""` when no nonce is present (OSS / non-strict mode), in which case
 * inline content is permitted by `'unsafe-inline'` and no nonce is needed.
 */
export async function getCspNonce(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get(CSP_NONCE_HEADER) ?? "";
}
