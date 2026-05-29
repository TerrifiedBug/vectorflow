"use client";

import * as React from "react";

/**
 * Carries the per-request CSP nonce down to client components so app-authored
 * inline `<style>` / `<script>` content can attach `nonce="<value>"` and remain
 * permitted under the strict multi-tenant CSP (which drops `'unsafe-inline'`).
 *
 * The value is supplied by a server component that reads the nonce from the
 * request headers (see `src/lib/csp-nonce.ts` / the root layout). In OSS /
 * non-strict mode the nonce is empty and the consuming components simply omit
 * the attribute, which is fine because `'unsafe-inline'` is allowed there.
 */
const NonceContext = React.createContext<string>("");

export function NonceProvider({
  nonce,
  children,
}: {
  nonce: string;
  children: React.ReactNode;
}) {
  return (
    <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>
  );
}

/**
 * Returns the per-request CSP nonce, or `undefined` when none is set (OSS /
 * non-strict mode). Pass the result straight to a `nonce` prop — `undefined`
 * renders no attribute.
 */
export function useCspNonce(): string | undefined {
  const nonce = React.useContext(NonceContext);
  return nonce || undefined;
}
