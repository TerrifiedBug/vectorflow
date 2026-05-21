import { errorLog, infoLog, warnLog } from "@/lib/logger";

/**
 * Boot-time assertion that catches the silent downgrade described in
 *
 * Background — `isStrictMultiTenantMode()` reads
 * `process.env.VF_STRICT_MULTI_TENANT === "true"` and is the kill-switch
 * for:
 *   - `__Host-`-prefixed session/CSRF cookies (`strict-cookies.ts`,
 *     `cloud-cookies.ts`)
 *   - Strict nonce-based CSP (`security-headers.ts`, `proxy.ts`)
 *   - The OSS PlatformOperator setup-bootstrap conditional
 *     (`setup.ts:81`)
 *
 * A typo / missing env var on a cloud stamp (`VF_STRICT_MULTITENANT`,
 * `VF_STRICT_MULTI_TENANT=1`, the variable not set at all) silently
 * downgrades the deployment to OSS single-tenant defaults: relaxed
 * cookies, `unsafe-inline` CSP, and a reachable `/api/setup` that an
 * attacker can race to become operator. Catching this at boot — rather
 * than after the first cross-tenant incident — is the whole point.
 *
 * Signals that "this deployment SHOULD be strict multi-tenant":
 *
 *   1. `NEXTAUTH_SECRET_OPERATOR` is set. Only the cloud operator-side
 *      auth surface ever reads it; OSS self-hosted never does.
 *   2. `VF_REQUIRE_STRICT_MULTI_TENANT=true`. Explicit operator opt-in
 *      that survives renames / future cloud-only env churn — lets a
 *      self-hosted multi-tenant deployment also enforce the assertion.
 *
 * Behaviour:
 *   - If neither signal is present → no-op (OSS self-hosted is fine
 *     without strict mode).
 *   - If a signal is present AND `VF_STRICT_MULTI_TENANT !== "true"` →
 *     log FATAL and `process.exit(1)`. We refuse to boot rather than
 *     ship insecure defaults under a deployment that thinks it's
 *     hardened.
 *   - If a signal is present AND strict mode IS on → log INFO so the
 *     boot trace records the active profile.
 */

function isStrictMultiTenantExpected(): {
  expected: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (process.env.NEXTAUTH_SECRET_OPERATOR) {
    reasons.push("NEXTAUTH_SECRET_OPERATOR is set");
  }
  if (process.env.VF_REQUIRE_STRICT_MULTI_TENANT === "true") {
    reasons.push("VF_REQUIRE_STRICT_MULTI_TENANT=true");
  }
  return { expected: reasons.length > 0, reasons };
}

export function assertStrictMultiTenantBoot(opts?: {
  exit?: (code: number) => never;
}): void {
  const { expected, reasons } = isStrictMultiTenantExpected();
  if (!expected) return;

  const strictModeOn = process.env.VF_STRICT_MULTI_TENANT === "true";
  if (strictModeOn) {
    infoLog(
      "instrumentation",
      `Strict multi-tenant mode confirmed on boot (signals: ${reasons.join(", ")})`,
    );
    return;
  }

  const message =
    "FATAL: deployment indicates strict multi-tenant context " +
    `(${reasons.join(", ")}) but VF_STRICT_MULTI_TENANT is not "true". ` +
    "Refusing to boot — session cookies, CSP, and the operator-bootstrap " +
    "gate would silently downgrade to OSS single-tenant defaults. " +
    "Set VF_STRICT_MULTI_TENANT=true (or unset NEXTAUTH_SECRET_OPERATOR / " +
    "VF_REQUIRE_STRICT_MULTI_TENANT if this is intentional).";
  errorLog("instrumentation", message);
  // eslint-disable-next-line no-console
  console.error(`\n${message}\n`);
  (opts?.exit ?? process.exit)(1);
}

/**
 * Boot-time warning when the deployment trusts upstream proxy headers
 * for host derivation.
 *
 * When `VF_TRUST_FORWARDED_HOST=true` OR `VF_TRUST_PROXY_HEADERS=true`
 * (both env names are accepted to bridge historical configs) the app
 * reads `X-Forwarded-Host` for org resolution, OIDC issuer routing,
 * and exchange-code redeem-org validation. If the upstream proxy does
 * NOT strip client-supplied `X-Forwarded-*` headers before forwarding,
 * a tenant can spoof the host and cause every host-derived decision
 * to resolve to a different org. This warning surfaces the assumption
 * loudly at boot so an operator who flipped the flag without auditing
 * their ingress is reminded to re-check.
 *
 * Also emits an explicit warning if only one of the two synonymous
 * env vars is set, so operators do not silently rely on the side that
 * happens to be checked while another module reads the other.
 */
export function warnTrustForwardedHostIfOn(): void {
  const forwardedHost = process.env.VF_TRUST_FORWARDED_HOST === "true";
  const proxyHeaders = process.env.VF_TRUST_PROXY_HEADERS === "true";
  if (!forwardedHost && !proxyHeaders) return;

  const enabledVia = [
    forwardedHost ? "VF_TRUST_FORWARDED_HOST=true" : null,
    proxyHeaders ? "VF_TRUST_PROXY_HEADERS=true" : null,
  ]
    .filter((s): s is string => Boolean(s))
    .join(", ");

  warnLog(
    "instrumentation",
    "proxy-header trust is enabled (" +
      enabledVia +
      ") — the application now reads X-Forwarded-Host for org resolution, " +
      "OIDC routing, and exchange-code redeem-org checks. The upstream proxy " +
      "MUST strip client-supplied X-Forwarded-* headers before forwarding; " +
      "otherwise a tenant can spoof the host and force cross-org behaviour. " +
      "See docs/internal/architecture.md for the ingress contract.",
  );

  if (forwardedHost !== proxyHeaders) {
    warnLog(
      "instrumentation",
      "VF_TRUST_FORWARDED_HOST and VF_TRUST_PROXY_HEADERS are synonymous; " +
        "only one is set. Set both (or neither) to make the deployment " +
        "config obvious to the next operator who reads the env file.",
    );
  }
}

/**
 * Boot-time warning when the deployment is in strict multi-tenant mode
 * but no recognised mail transport is configured.
 *
 * The magic-link request endpoint logs a per-request warning when no
 * transport is wired in production — but by then the user has already
 * been told "ok" (anti-enumeration) and their signup has silently
 * failed. Surfacing the same gap at boot lets an operator catch the
 * misconfiguration during deploy rather than after a user complains.
 *
 * Recognised transports (any one is enough):
 *
 *   - `RESEND_API_KEY` — Resend.
 *   - `POSTMARK_API_KEY` — Postmark.
 *   - `SENDGRID_API_KEY` — SendGrid.
 *   - `SMTP_HOST` — generic SMTP relay; matches what the docker compose
 *     env example documents for self-hosted operators.
 *   - `VF_MAGIC_LINK_TRANSPORT` — explicit operator opt-out: set to any
 *     non-empty value when the transport is wired through a mechanism
 *     this check can't see (e.g. a sidecar that intercepts the warn-log
 *     line and delivers the link). The presence of the env var is the
 *     "I know what I'm doing" signal.
 *
 * Only fires when `VF_STRICT_MULTI_TENANT === "true"`. OSS self-hosted
 * stays quiet because most self-hosters don't use magic-link at all.
 */
const MAGIC_LINK_TRANSPORT_ENVS = [
  "RESEND_API_KEY",
  "POSTMARK_API_KEY",
  "SENDGRID_API_KEY",
  "SMTP_HOST",
  "VF_MAGIC_LINK_TRANSPORT",
] as const;

export function warnMissingMagicLinkTransport(): void {
  if (process.env.VF_STRICT_MULTI_TENANT !== "true") return;
  const hasTransport = MAGIC_LINK_TRANSPORT_ENVS.some(
    (k) => process.env[k] && process.env[k] !== "",
  );
  if (hasTransport) return;
  warnLog(
    "instrumentation",
    "strict multi-tenant mode is on but no magic-link mail transport is " +
      `configured. Set one of ${MAGIC_LINK_TRANSPORT_ENVS.join(", ")}; ` +
      "without it, every magic-link request returns 200 (anti-enumeration) " +
      "while the mail is silently dropped in " +
      "",
  );
}
