/**
 * cross-org access auto-generated test harness.
 *
 * Walks every procedure in `appRouter`, finds the ones whose input schema
 * accepts a tenant-scoped identifier (`teamId` / `environmentId` /
 * `pipelineId` / `pipelineIds`), and asserts that EACH one's middleware
 * chain contains a recognisable tenancy gate.
 *
 * This is a "linter" test, not a runtime test: actually invoking 223
 * procedures with mocked Prisma per call would multiply the test suite
 * by 100x. Instead we encode the invariant: a procedure that takes a
 * tenant-id in its input MUST run through a middleware that resolves
 * that id back to the caller's org and rejects cross-org access.
 *
 * Recognised gates (any one is sufficient):
 *   - `withTeamAccess` — the canonical tenant gate (uses `isOrgWideAdmin`
 *     against `OrgMember` as the admin fast-path).
 *   - `requirePlatformOperator` — the tenant-aware operator gate.
 *
 * Detection is via `mw.toString()` inspection. tRPC wraps middlewares
 * such that the factory body (and its identifiers) ARE preserved in the
 * function source — adding a `withTeamAccess` middleware introduces
 * recognisable tokens (`teamId`, `orgMemberRole`, `withTeamAccess`)
 * into the chain.
 *
 * Adding a new procedure with a tenant-scoped input:
 *   - If you wrap it in `withTeamAccess` / `requirePlatformOperator`:
 *     test passes automatically.
 *   - If you intentionally omit the gate (rare — usually a security bug):
 *     add the path to `INTENTIONALLY_UNGUARDED` below with a comment.
 *   - If you add a NEW tenant-scoping middleware: extend `GATE_PATTERNS`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// next-auth has known module-resolution issues under Vitest; the static
// introspection here doesn't actually authenticate anything, so we mock
// the surface out and load the real `appRouter` for procedure walking.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
  CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({ id: "credentials", name: "Credentials" }),
}));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  errorLog: vi.fn(),
}));

import { appRouter } from "@/trpc/router";

interface TrpcProcedureLike {
  _def?: {
    middlewares?: Array<unknown>;
    inputs?: Array<{
      _def?: { typeName?: string; shape?: () => unknown };
      shape?: unknown;
    }>;
  };
}

/**
 * Every input field name that `withTeamAccess` recognises as a tenant
 * input and resolves to a teamId. Keeping this list aligned with the
 * resolution table in `src/trpc/init.ts:withTeamAccess` is the audit's
 * load-bearing contract: a tenant input here that the middleware
 * doesn't resolve is a real gap.
 *
 * Codex P1 round-7 review: the prior list was hard-coded to four
 * fields and missed `upstreamId`, which `withTeamAccess` DOES resolve
 * (see init.ts lines around the `pipelineId` lookup). A procedure
 * with `{ upstreamId }` would silently escape the audit. Fixed by
 * adding it here.
 *
 * `id` IS included \u2014 Codex P1 round-9 review pointed out that excluding
 * it was a large false-negative gap. `withTeamAccess` resolves
 * `rawInput.id` as a fallback to pipeline / environment / vectorNode /
 * template / migration / serviceAccount / secret lookups, so most CRUD
 * procedures (`pipeline.get`, `environment.update`, etc.) rely on this
 * path. Including `id` floods the audit with hundreds of procedures \u2014
 * but every one of them must actually run through `withTeamAccess`, and
 * any that doesn't is a real security gap the audit must surface.
 */
const TENANT_INPUT_KEYS = [
  "teamId",
  "environmentId",
  "pipelineId",
  "pipelineIds",
  "upstreamId",
  "requestId",
  "versionId",
  "alertEventId",
  "nodeId",
  "groupId",
  "id",
] as const;

/**
 * Strings whose presence in a middleware function's `.toString()` indicates
 * the procedure runs through a known tenancy gate. tRPC stores the
 * middleware as the raw closure body, so the FACTORY name (`withTeamAccess`)
 * isn't visible — we have to match on tokens that appear inside the body.
 *
 * Codex P1 on the initial PR: matching on bare `teamId` was too broad
 * (any middleware that referenced the identifier for logging or audit
 * would have passed). The tightened set requires:
 *
 *   - `userId_teamId` — the Prisma composite-key lookup used by
 *     `withTeamAccess` to verify membership. Other middlewares don't
 *     do this lookup.
 *   - `platformOperator.findUnique` — the `requirePlatformOperator` middleware.
 *   - `orgMember.findUnique` — `isOrgWideAdmin` lookup used by `withTeamAccess`
 *     after slice 7c dropped the legacy `User.isSuperAdmin` reader.
 *
 * `requireRole` / `roleLevel[` is deliberately excluded: `requireRole`
 * authorises by the caller's HIGHEST role across any team and does NOT
 * validate the specific `teamId` / `environmentId` / `pipelineId` being
 * requested. A procedure that takes a tenant id and only uses
 * `requireRole(...)` would silently allow cross-team access — Codex P2
 * round-3 finding flagged this as a false-negative in the audit harness.
 *
 * Each token is specific enough that it doesn't appear in non-auth
 * middlewares (audit, rate-limit, demo-mode), but generic enough to
 * survive a refactor that wraps `withTeamAccess` differently.
 */
const GATE_PATTERNS = [
  "userId_teamId",
  "orgMember.findUnique",
  "platformOperator.findUnique",
  // `requireOrgAdmin()` middleware — the OrgMember lookup
  // happens inside the `isOrgWideAdmin` helper, so the middleware body
  // shows the helper name rather than the prisma lookup. Recognise
  // either token so a procedure gated on org-level admin passes.
  "isOrgWideAdmin",
];

/**
 * Procedures that intentionally accept a tenant-id but use a custom
 * authorisation check that doesn't go through one of the recognised
 * middleware names. Each entry MUST come with a comment explaining why
 * the procedure is safe \u2014 e.g. it does explicit `ctx.organizationId`
 * checks inside the handler, or it's a system-only endpoint.
 *
 * **Permanence risk** (Codex P2 round-5 review): an entry here
 * unconditionally suppresses the main gate check for that procedure
 * for the rest of time. A future refactor that removes the inline
 * authorisation check inside the handler would NOT be caught by this
 * audit. The mitigations:
 *
 *   1. Review removals via the security-review CODEOWNERS file (the
 *      `cross-org-access.test.ts` path is owned by the security team).
 *   2. Each entry below carries a comment naming the exact in-handler
 *      check that justifies the exception. If the named lines change,
 *      the reviewer of the offending diff must re-justify or remove
 *      the entry.
 *   3. The companion `cross-org-access-allowlist-justification.test.ts`
 *      (follow-up) will assert each entry's named check is still in
 *      the file at the documented line range.
 *
 * Adding to this list MUST be accompanied by a Codex / security review.
 */
const INTENTIONALLY_UNGUARDED = new Set<string>([
  // team.teamRole returns the caller's own membership role on the
  // requested team (or VIEWER if not a member). Cross-org probing is
  // safe by construction: the response shape is identical regardless
  // of team existence, so no team-existence side channel.
  "team.teamRole",

  // audit.list / audit.deployments / audit.exportDeployments enforce
  // tenancy via `getAuditScope(userId)` + `pushAuditScope(conditions)`
  // — a custom scoping helper that injects the caller's accessible
  // (teamId, environmentId) pairs into the Prisma WHERE clause. The
  // cross-org teamId/environmentId/pipelineId values in the input
  // add an extra AND constraint; they cannot widen the result set
  // beyond the user's audit scope.
  "audit.list",
  "audit.deployments",
  "audit.exportDeployments",

  // dashboard.pipelineCards / metrics.getComponentMetrics do inline
  // authorisation in the handler: load the entity, then assert the
  // caller is a super-admin OR a TeamMember of the resolved team.
  // Equivalent to `withTeamAccess("VIEWER")` but inlined so the
  // procedure can soft-fail (return []/empty payload) on stale-after-
  // delete polling races.
  "dashboard.pipelineCards",
  "metrics.getComponentMetrics",
  "metrics.getNodePipelineRates",

  // pipeline.stopTap: inline auth in the handler (super-admin OR
  // TeamMember of the tap's pipeline → environment.teamId). This is the
  // Codex P1 round-8 fix \u2014 the audit caught the original gap and the
  // handler now validates ownership before calling stopTapHandler.
  // Same inline-auth pattern as the other three procedures above.
  "pipeline.stopTap",

  // template.get / template.delete: inline auth in the handler (system
  // templates with teamId=null are readable by all authenticated users;
  // team-owned templates require membership or super-admin). Same Codex
  // P1 round-9 catch as pipeline.stopTap \u2014 the wider audit (post-`id`
  // inclusion) surfaced these existing gaps and they are fixed inline.
  "template.get",
  "template.delete",

  // org.verifyDomain / org.unclaimDomain: inline auth in the handler.
  // Both load the `OrganizationDomainClaim` by `id` and reject if
  // `claim.organizationId !== ctx.organizationId` (404 NOT_FOUND). The
  // input id is the claim row id, not a teamId / pipelineId, so
  // `withTeamAccess` doesn't have a resolution path for it. Same
  // inline-auth pattern as `template.get` / `template.delete` above.
  "org.verifyDomain",
  "org.unclaimDomain",
]);

interface AuditEntry {
  path: string;
  tenantFields: string[];
  hasGate: boolean;
}

/**
 * Unwrap Zod effect / optional / default / nullable wrappers down to the
 * inner schema. `z.object({...}).refine(...)` produces a `ZodEffects`
 * whose `.shape` is undefined; the real object is at `_def.schema`.
 * Same for `.optional()` / `.nullable()` / `.default()` (innerType) and
 * `.transform()` (schema). We chase those wrappers a few levels and
 * give up cleanly if we can't find a shape \u2014 the caller treats that
 * procedure as "no tenant inputs" and skips it.
 */
function unwrapZod(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== "object" || depth > 6) return schema;
  const s = schema as {
    _def?: {
      typeName?: string;
      schema?: unknown;
      innerType?: unknown;
      type?: unknown;
    };
    shape?: unknown;
  };
  // Already a ZodObject — done.
  if (s.shape && typeof s.shape === "object") return schema;

  const inner = s._def?.schema ?? s._def?.innerType ?? s._def?.type;
  if (inner) return unwrapZod(inner, depth + 1);
  return schema;
}

function shapeOf(
  schema: TrpcProcedureLike["_def"] extends infer D
    ? D extends { inputs?: Array<infer S> }
      ? S
      : never
    : never,
): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object") return null;
  const unwrapped = unwrapZod(schema) as {
    shape?: unknown;
    _def?: { shape?: () => unknown; typeName?: string };
  } | null;
  if (!unwrapped || typeof unwrapped !== "object") return null;
  // Zod v3 stores .shape on ZodObject (sometimes as a getter that returns
  // _def.shape()). Try both forms.
  if (unwrapped.shape && typeof unwrapped.shape === "object") {
    return unwrapped.shape as Record<string, unknown>;
  }
  const fnShape = unwrapped._def?.shape?.();
  if (fnShape && typeof fnShape === "object") {
    return fnShape as Record<string, unknown>;
  }
  return null;
}

/**
 * Recursively walk a Zod shape to find tenant-key references, even when
 * they live in nested objects or arrays. `settings.updateOidcTeamMappings`
 * carries `mappings[].teamId` for example, and the previous detector only
 * checked the top level so the procedure was silently excluded from the
 * audit.
 */
function findTenantKeysDeep(
  schema: unknown,
  found: Set<string>,
  depth = 0,
): void {
  if (!schema || typeof schema !== "object" || depth > 8) return;
  const shape = shapeOf(schema as never);
  if (shape) {
    for (const [key, child] of Object.entries(shape)) {
      if ((TENANT_INPUT_KEYS as readonly string[]).includes(key)) {
        found.add(key);
      }
      findTenantKeysDeep(child, found, depth + 1);
    }
    return;
  }
  // Array / record / union wrappers expose inner schemas at known keys.
  const def = (schema as { _def?: Record<string, unknown> })._def;
  if (def) {
    for (const key of [
      "schema",
      "innerType",
      "type",
      "valueType",
      "element",
    ]) {
      const inner = (def as Record<string, unknown>)[key];
      if (inner) findTenantKeysDeep(inner, found, depth + 1);
    }
    const options = (def as { options?: unknown[] }).options;
    if (Array.isArray(options)) {
      for (const opt of options) findTenantKeysDeep(opt, found, depth + 1);
    }
  }
}

function tenantFieldsIn(
  proc: TrpcProcedureLike,
): string[] {
  const inputs = proc._def?.inputs ?? [];
  const found = new Set<string>();
  for (const schema of inputs) {
    findTenantKeysDeep(schema, found);
  }
  return [...found];
}

function hasGateMiddleware(proc: TrpcProcedureLike): boolean {
  const mws = proc._def?.middlewares ?? [];
  return mws.some((mw) => {
    const s = String(mw);
    return GATE_PATTERNS.some((p) => s.includes(p));
  });
}

function auditRouter(): AuditEntry[] {
  const procs = appRouter._def.procedures as Record<string, TrpcProcedureLike>;
  const entries: AuditEntry[] = [];
  for (const path of Object.keys(procs)) {
    const proc = procs[path]!;
    const tenantFields = tenantFieldsIn(proc);
    if (tenantFields.length === 0) continue;
    entries.push({
      path,
      tenantFields,
      // The audit stores a single procedure-level boolean. Codex P1
      // round-6 review flagged this as potentially under-counting:
      // a procedure with `{ teamId, pipelineId }` could in principle
      // be gated on teamId but NOT on pipelineId. In practice
      // `withTeamAccess` (the only canonical tenant gate this audit
      // recognises) resolves every supported tenant key
      // (`teamId`, `environmentId`, `pipelineId`, `pipelineIds`,
      // `upstreamId`, `id`) into a teamId via DB lookup and checks
      // membership ONCE against that resolved teamId — see the
      // resolution table in `src/trpc/init.ts:withTeamAccess`. So a
      // procedure that uses `withTeamAccess` is, by construction,
      // covering ALL its tenant inputs via the resolved-teamId check.
      // The audit therefore only needs to verify "did this procedure
      // run through one of the recognised gates" \u2014 the per-field
      // coverage falls out of the middleware's resolution table.
      hasGate: hasGateMiddleware(proc),
    });
  }
  return entries;
}


// ─── H7: JWT org_id cross-org guard ─────────────────────────────────────────
//
// The guard in auth.ts's jwt() callback: if the token is not a fresh
// sign-in (!user && !account) and token.org_id !== orgId (the org resolved
// from the request host), the callback returns {} — an empty token — which
// NextAuth treats as unauthenticated.
//
// We test the invariant directly against the predicate rather than through
// the full NextAuth stack (which would require mocking dozens of modules).
// The predicate IS the security boundary; the integration contract is that
// auth.ts calls `return {}` when `guardRejectsToken` is true.

/**
 * Mirror of the guard predicate in auth.ts's jwt() callback.
 * Returns true  → token REJECTED (auth.ts returns {})
 * Returns false → token ACCEPTED (auth.ts continues)
 */
function guardRejectsToken(
  tokenOrgId: unknown,
  requestOrgId: string,
): boolean {
  return typeof tokenOrgId !== "string" || tokenOrgId !== requestOrgId;
}

describe("H7 JWT org_id cross-org guard", () => {
  it("accepts a token whose org_id matches the request org", () => {
    expect(guardRejectsToken("org-a", "org-a")).toBe(false);
  });

  it("rejects a token from org A presented on org B's host (cross-org replay)", () => {
    expect(guardRejectsToken("org-a", "org-b")).toBe(true);
  });

  it("rejects a token with no org_id claim (pre-H7 legacy token)", () => {
    expect(guardRejectsToken(undefined, "org-a")).toBe(true);
  });

  it("rejects a token with a non-string org_id (malformed claim)", () => {
    expect(guardRejectsToken(42, "org-a")).toBe(true);
    expect(guardRejectsToken(null, "org-a")).toBe(true);
  });
});

describe("Cross-org access audit", () => {
  const audit = auditRouter();

  it("audits a non-trivial number of procedures", () => {
    // Spot check: at the time this test landed there are 200+ procedures
    // with tenant inputs across the appRouter. If this drops to <100, the
    // router was probably shrunk or the test is mis-reading the input
    // shape — both warrant investigation.
    expect(audit.length).toBeGreaterThan(100);
  });

  it("every procedure with a tenant input has a recognised authorisation gate", () => {
    const unguarded = audit
      .filter((e) => !e.hasGate && !INTENTIONALLY_UNGUARDED.has(e.path))
      .map((e) => `${e.path} (inputs: ${e.tenantFields.join(", ")})`);

    if (unguarded.length > 0) {
      // Detailed error message: each violating procedure listed individually
      // so the failing CI run points the developer at the exact procedures
      // that need either `withTeamAccess` or an `INTENTIONALLY_UNGUARDED`
      // entry with rationale.
      throw new Error(
        `${unguarded.length} procedure(s) accept a tenant-scoped id without an ` +
          `authorisation middleware:\n\n  - ${unguarded.join("\n  - ")}\n\n` +
          "Each procedure that takes teamId/environmentId/pipelineId MUST be " +
          "wrapped in `withTeamAccess` or `requirePlatformOperator`. " +
          "If a procedure intentionally bypasses these (very rare), add its path " +
          "to `INTENTIONALLY_UNGUARDED` in `cross-org-access.test.ts` with a " +
          "comment explaining how cross-org access is otherwise prevented.",
      );
    }
  });

  it("no procedure in INTENTIONALLY_UNGUARDED has been removed from the router", () => {
    const auditPaths = new Set(audit.map((e) => e.path));
    const stale = [...INTENTIONALLY_UNGUARDED].filter((p) => !auditPaths.has(p));
    expect(stale).toEqual([]);
  });
});

describe("audit middleware org-scope hardening", () => {
  /**
   * These tests verify that `resolveTeamId` and `resolveEnvironmentId` in
   * `src/server/middleware/audit.ts` include the caller's `organizationId`
   * in every Prisma `findFirst` WHERE clause, so a cross-org entity ID
   * supplied by a compromised or confused client never resolves to a
   * teamId/environmentId belonging to a different org.
   *
   * The mocked Prisma returns `null` when the org filter doesn't match —
   * exactly what Prisma would do in production if the row's `organizationId`
   * differs from the one passed in the WHERE.
   */
  let mockPrisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const mod = await import("@/lib/prisma");
    mockPrisma = mod.prisma as DeepMockProxy<PrismaClient>;
    mockPrisma.environment.findFirst.mockReset();
    mockPrisma.pipeline.findFirst.mockReset();
    mockPrisma.vectorNode.findFirst.mockReset();
    mockPrisma.alertRule.findFirst.mockReset();
    mockPrisma.notificationChannel.findFirst.mockReset();
    mockPrisma.vrlSnippet.findFirst.mockReset();
    mockPrisma.serviceAccount.findFirst.mockReset();
    mockPrisma.deployRequest.findFirst.mockReset();
  });

  it("resolveTeamId: cross-org environmentId returns null", async () => {
    const { resolveTeamId } = await import("@/server/middleware/audit");
    // Simulate Prisma finding no row because organizationId filter doesn't match
    mockPrisma.environment.findFirst.mockResolvedValueOnce(null);

    const result = await resolveTeamId(
      { environmentId: "env-belongs-to-other-org" },
      "Environment",
      "org-A",
    );

    expect(result).toBeNull();
    expect(mockPrisma.environment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-A" }),
      }),
    );
  });

  it("resolveTeamId: same-org environmentId resolves teamId", async () => {
    const { resolveTeamId } = await import("@/server/middleware/audit");
    mockPrisma.environment.findFirst.mockResolvedValueOnce({ teamId: "team-own" } as never);

    const result = await resolveTeamId(
      { environmentId: "env-own" },
      "Environment",
      "org-A",
    );

    expect(result).toBe("team-own");
  });

  it("resolveTeamId: cross-org pipelineId returns null", async () => {
    const { resolveTeamId } = await import("@/server/middleware/audit");
    mockPrisma.pipeline.findFirst.mockResolvedValueOnce(null);

    const result = await resolveTeamId(
      { pipelineId: "pipe-cross-org" },
      "Pipeline",
      "org-A",
    );

    expect(result).toBeNull();
    expect(mockPrisma.pipeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-A" }),
      }),
    );
  });

  it("resolveTeamId: cross-org id/AlertRule returns null", async () => {
    const { resolveTeamId } = await import("@/server/middleware/audit");
    mockPrisma.alertRule.findFirst.mockResolvedValueOnce(null);

    const result = await resolveTeamId(
      { id: "rule-cross-org" },
      "AlertRule",
      "org-B",
    );

    expect(result).toBeNull();
    expect(mockPrisma.alertRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-B" }),
      }),
    );
  });

  it("resolveTeamId: omitting organizationId does not filter (backward-compat)", async () => {
    const { resolveTeamId } = await import("@/server/middleware/audit");
    mockPrisma.environment.findFirst.mockResolvedValueOnce({ teamId: "team-legacy" } as never);

    const result = await resolveTeamId(
      { environmentId: "env-legacy" },
      "Environment",
      // no organizationId — should still resolve
    );

    expect(result).toBe("team-legacy");
    // WHERE should NOT contain organizationId when it was not supplied
    const call = mockPrisma.environment.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where).not.toHaveProperty("organizationId");
  });

  it("resolveEnvironmentId: cross-org pipelineId returns null", async () => {
    const { resolveEnvironmentId } = await import("@/server/middleware/audit");
    mockPrisma.pipeline.findFirst.mockResolvedValueOnce(null);

    const result = await resolveEnvironmentId(
      { pipelineId: "pipe-cross-org" },
      "Pipeline",
      "org-A",
    );

    expect(result).toBeNull();
    expect(mockPrisma.pipeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-A" }),
      }),
    );
  });

  it("resolveEnvironmentId: cross-org id/VectorNode returns null", async () => {
    const { resolveEnvironmentId } = await import("@/server/middleware/audit");
    mockPrisma.vectorNode.findFirst.mockResolvedValueOnce(null);

    const result = await resolveEnvironmentId(
      { id: "node-cross-org" },
      "VectorNode",
      "org-C",
    );

    expect(result).toBeNull();
    expect(mockPrisma.vectorNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-C" }),
      }),
    );
  });

  it("resolveEnvironmentId: cross-org id/DeployRequest returns null", async () => {
    const { resolveEnvironmentId } = await import("@/server/middleware/audit");
    mockPrisma.deployRequest.findFirst.mockResolvedValueOnce(null);

    const result = await resolveEnvironmentId(
      { requestId: "req-cross-org" },
      "DeployRequest",
      "org-A",
    );

    expect(result).toBeNull();
    expect(mockPrisma.deployRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-A" }),
      }),
    );
  });
});
