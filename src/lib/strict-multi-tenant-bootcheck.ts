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
 * When `VF_TRUST_FORWARDED_HOST=true` the app reads `X-Forwarded-Host`
 * for org resolution, OIDC issuer routing, and exchange-code redeem-org
 * validation. If the upstream proxy does NOT strip client-supplied
 * `X-Forwarded-*` headers before forwarding, a tenant can spoof the
 * host and cause every host-derived decision to resolve to a different
 * org. This warning surfaces the assumption loudly at boot so an
 * operator who flipped the flag without auditing their ingress is
 * reminded to re-check.
 *
 * `VF_TRUST_PROXY_HEADERS` is INTENTIONALLY not accepted as an alias
 * for host trust — it governs forwarded-client-IP trust (rate-limit
 * keying, dev bypass) only. If an operator has set the IP-trust flag
 * without the host-trust flag, we also warn so the gap is visible —
 * either they want host trust too (set both) or they explicitly do not
 * (silence by setting `VF_TRUST_FORWARDED_HOST=false` once).
 */
export function warnTrustForwardedHostIfOn(): void {
  const forwardedHost = process.env.VF_TRUST_FORWARDED_HOST === "true";
  const proxyHeaders = process.env.VF_TRUST_PROXY_HEADERS === "true";

  if (forwardedHost) {
    warnLog(
      "instrumentation",
      "VF_TRUST_FORWARDED_HOST=true — the application now reads " +
        "X-Forwarded-Host for org resolution, OIDC routing, and " +
        "exchange-code redeem-org checks. The upstream proxy MUST strip " +
        "client-supplied X-Forwarded-* headers before forwarding; " +
        "otherwise a tenant can spoof the host and force cross-org " +
        "behaviour. See docs/internal/architecture.md for the ingress " +
        "contract.",
    );
  }

  if (proxyHeaders && !forwardedHost) {
    // The two env vars are NOT synonymous (Codex P1 on PR #390). This
    // warning surfaces the asymmetry to the operator so they don't
    // silently rely on the IP-trust flag for host trust too.
    warnLog(
      "instrumentation",
      "VF_TRUST_PROXY_HEADERS=true is set but VF_TRUST_FORWARDED_HOST " +
        "is not. The two flags control different surfaces: the former " +
        "governs forwarded-client-IP trust only (rate-limit keying, " +
        "dev bypass), while the latter is required to honour " +
        "X-Forwarded-Host for org / auth routing. If the deployment " +
        "runs behind a reverse proxy that sets X-Forwarded-Host, also " +
        "set VF_TRUST_FORWARDED_HOST=true.",
    );
  }
}


type RlsProbeClient = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

/**
 * RLS enforcement boot probe — the GA gate from
 * `cloud/docs/rls-isolation-model.md`.
 *
 * Opt-in via `VF_ENFORCE_RLS=true` — a DEDICATED flag, intentionally separate
 * from `VF_STRICT_MULTI_TENANT`, so enabling strict cookies/CSP does NOT also
 * demand RLS enforcement before the `withOrgTx` / `vectorflow_app` rollout has
 * landed. When enabled, refuses to boot unless the Postgres role the app
 * connects as actually has RLS enforced:
 *
 *   1. `current_user` is NOT a BYPASSRLS role (`rolbypassrls = false`),
 *   2. at least one tenant table carries an `app.org_id` RLS policy, and
 *   3. with no `app.org_id` GUC set, that table exposes NO rows (the policy
 *      fires on this connection rather than leaking every tenant's rows).
 *
 * Until the rollout flips `DATABASE_URL` to the NOBYPASSRLS `vectorflow_app`
 * role, this probe WILL fail on the owner role — which is the point: it stops
 * an image advertising RLS from shipping while RLS is still bypassed. OSS
 * single-tenant never sets `VF_ENFORCE_RLS` and is unaffected.
 */
export async function assertRlsEnforcementBoot(opts?: {
  exit?: (code: number) => never;
  client?: RlsProbeClient;
}): Promise<void> {
  if (process.env.VF_ENFORCE_RLS !== "true") return;

  const exit = opts?.exit ?? process.exit;
  let db = opts?.client;
  if (!db) {
    // Lazy import so this module (and its tests) don't pull in the Prisma
    // singleton / env validation unless the probe actually runs.
    const { prisma } = await import("@/lib/prisma");
    db = prisma as unknown as RlsProbeClient;
  }

  let bypassesRls = true;
  let policyTable: string | null = null;
  let leaked = false;
  try {
    const roleRows = await db.$queryRawUnsafe<Array<{ rolbypassrls: boolean }>>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    bypassesRls = roleRows[0]?.rolbypassrls === true;

    const policyRows = await db.$queryRawUnsafe<Array<{ tablename: string }>>(
      "SELECT tablename FROM pg_policies WHERE schemaname = 'public' " +
        "AND qual LIKE '%app.org_id%' ORDER BY tablename LIMIT 1",
    );
    policyTable = policyRows[0]?.tablename ?? null;

    if (policyTable) {
      const quoted = policyTable.replace(/"/g, '""');
      const leakRows = await db.$queryRawUnsafe<Array<{ leaked: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM "${quoted}") AS leaked`,
      );
      leaked = leakRows[0]?.leaked === true;
    }
  } catch (err) {
    const message =
      "FATAL: VF_ENFORCE_RLS=true but the RLS enforcement probe could not run: " +
      `${(err as Error).message}. Refusing to boot rather than assume the ` +
      "database backstop is active.";
    errorLog("instrumentation", message);
    console.error(`\n${message}\n`);
    return exit(1);
  }

  const failures: string[] = [];
  if (bypassesRls) {
    failures.push(
      "the app connects as a BYPASSRLS Postgres role (rolbypassrls = true) — " +
        "RLS policies never fire. Point DATABASE_URL at the NOBYPASSRLS " +
        "vectorflow_app role (scripts/grant-vectorflow-app.sql).",
    );
  }
  if (!policyTable) {
    failures.push(
      "no tenant table carries an app.org_id RLS policy — the policies are not " +
        "provisioned in this database.",
    );
  } else if (leaked) {
    failures.push(
      `tenant table "${policyTable}" exposed rows with no app.org_id GUC set — ` +
        "the RLS policy is not blocking unscoped reads on this connection.",
    );
  }

  if (failures.length > 0) {
    const message =
      "FATAL: VF_ENFORCE_RLS=true but RLS is not actually enforced:\n" +
      failures.map((f) => `  - ${f}`).join("\n") +
      "\nRefusing to boot. Complete the RLS rollout " +
      "(cloud/docs/rls-isolation-model.md) before enabling VF_ENFORCE_RLS.";
    errorLog("instrumentation", message);
    console.error(`\n${message}\n`);
    return exit(1);
  }

  infoLog(
    "instrumentation",
    "RLS enforcement probe passed: non-bypass role and app.org_id policy fires.",
  );
}
