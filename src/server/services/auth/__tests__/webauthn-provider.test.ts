import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  finishAuthentication: vi.fn(),
  userFindUnique: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  getSamlSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/server/services/webauthn", () => ({
  finishAuthentication: mocks.finishAuthentication,
}));
vi.mock("@/lib/prisma", () => { const __pm = { user: { findUnique: mocks.userFindUnique } }; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  errorLog: vi.fn(),
}));
vi.mock("@/server/services/auth/saml-config", () => ({
  getSamlSettings: mocks.getSamlSettings,
}));

import { authorizeWebauthn } from "../webauthn-provider";

function authorize(credentials: Record<string, unknown>): Promise<unknown> {
  return authorizeWebauthn(credentials);
}

const goodAssertion = JSON.stringify({
  id: "cred-1",
  rawId: "cred-1",
  response: { /* simplified */ },
  type: "public-key",
});

describe("webauthnProvider", () => {
  beforeEach(() => {
    mocks.finishAuthentication.mockReset();
    mocks.userFindUnique.mockReset();
    mocks.writeAuditLog.mockClear();
    mocks.getSamlSettings.mockResolvedValue(null);
  });

  it("denies WebAuthn login when the org enforces SAML SSO (no passkey bypass)", async () => {
    mocks.getSamlSettings.mockResolvedValue({ enforced: true });
    const result = await authorize({ assertionJSON: goodAssertion });
    expect(result).toBeNull();
    expect(mocks.finishAuthentication).not.toHaveBeenCalled();
  });

  it("returns the NextAuth user on a successful assertion", async () => {
    mocks.finishAuthentication.mockResolvedValue({
      userId: "user-1",
      credentialId: "cred-1",
    });
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
      lockedAt: null,
    });

    const result = (await authorize({ assertionJSON: goodAssertion })) as
      | null
      | { id: string; email: string };
    expect(result).toEqual({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "auth.login_succeeded",
        entityId: "webauthn",
      }),
    );
  });

  it("returns null when the assertion JSON is malformed", async () => {
    const result = await authorize({ assertionJSON: "{not json" });
    expect(result).toBeNull();
    expect(mocks.finishAuthentication).not.toHaveBeenCalled();
  });

  it("returns null when finishAuthentication throws (replay / counter regression)", async () => {
    mocks.finishAuthentication.mockRejectedValue(new Error("replay"));
    const result = await authorize({ assertionJSON: goodAssertion });
    expect(result).toBeNull();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns null when the verified userId no longer exists", async () => {
    mocks.finishAuthentication.mockResolvedValue({
      userId: "ghost",
      credentialId: "cred-1",
    });
    mocks.userFindUnique.mockResolvedValue(null);
    const result = await authorize({ assertionJSON: goodAssertion });
    expect(result).toBeNull();
  });

  it("returns null when the user is locked", async () => {
    mocks.finishAuthentication.mockResolvedValue({
      userId: "user-1",
      credentialId: "cred-1",
    });
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
      lockedAt: new Date(),
    });
    const result = await authorize({ assertionJSON: goodAssertion });
    expect(result).toBeNull();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects calls with no assertionJSON", async () => {
    const result = await authorize({});
    expect(result).toBeNull();
  });
});

describe("production RP_ID gating (graceful degradation)", () => {
  // A missing VF_WEBAUTHN_RP_ID must NOT take down the whole auth surface.
  // auth.ts statically imports this module, so a module-load throw would 500
  // password + OIDC sign-in too. Instead WebAuthn is disabled per-method:
  // the module still imports, ceremonies are refused, and other methods work.
  async function withEnv(
    opts: { rpId?: string | null; nodeEnv?: string; phase?: string },
    fn: (mod: typeof import("../webauthn-provider")) => Promise<void>,
  ) {
    const savedRpId = process.env.VF_WEBAUTHN_RP_ID;
    try {
      if (opts.rpId == null) delete process.env.VF_WEBAUTHN_RP_ID;
      else process.env.VF_WEBAUTHN_RP_ID = opts.rpId;
      if (opts.nodeEnv) vi.stubEnv("NODE_ENV", opts.nodeEnv);
      if (opts.phase) vi.stubEnv("NEXT_PHASE", opts.phase);
      // src/lib/env.ts refuses to boot in production without VF_ENCRYPTION_KEY_V2;
      // this suite stubs NODE_ENV=production only to exercise WebAuthn RP_ID
      // gating, so acknowledge the derived-key coupling to let @/lib/env validate.
      vi.stubEnv("VF_ALLOW_NEXTAUTH_DERIVED_KEY", "true");
      vi.resetModules();
      await fn(await import("../webauthn-provider"));
    } finally {
      vi.unstubAllEnvs();
      if (savedRpId !== undefined) process.env.VF_WEBAUTHN_RP_ID = savedRpId;
      else delete process.env.VF_WEBAUTHN_RP_ID;
      vi.resetModules();
    }
  }

  it("imports without throwing in production even when VF_WEBAUTHN_RP_ID is unset", async () => {
    await withEnv({ rpId: null, nodeEnv: "production" }, async (mod) => {
      expect(mod.webauthnProvider).toBeDefined();
      expect(mod.isWebauthnEnabled()).toBe(false);
    });
  });

  it("refuses the ceremony (returns null) in production without VF_WEBAUTHN_RP_ID", async () => {
    await withEnv({ rpId: null, nodeEnv: "production" }, async (mod) => {
      await expect(
        mod.authorizeWebauthn({ assertionJSON: goodAssertion }),
      ).resolves.toBeNull();
      // The ceremony is refused up-front — never reaches verification.
      expect(mocks.finishAuthentication).not.toHaveBeenCalled();
    });
  });

  it("stays enabled during next build even without VF_WEBAUTHN_RP_ID", async () => {
    // `next build` statically imports server modules under NODE_ENV=production
    // without runtime env; the check must defer to per-request runtime so it
    // does not break page-data collection (CI failure on /api/auth/oidc-status).
    await withEnv(
      { rpId: null, nodeEnv: "production", phase: "phase-production-build" },
      async (mod) => {
        expect(mod.isWebauthnEnabled()).toBe(true);
      },
    );
  });

  it("is enabled when NODE_ENV=production and VF_WEBAUTHN_RP_ID is set", async () => {
    await withEnv({ rpId: "example.com", nodeEnv: "production" }, async (mod) => {
      expect(mod.isWebauthnEnabled()).toBe(true);
    });
  });

  it("is enabled in dev/test even when VF_WEBAUTHN_RP_ID is unset", async () => {
    // NODE_ENV=test is the vitest default — not production, so the localhost
    // fallback is allowed and WebAuthn is enabled.
    await withEnv({ rpId: null }, async (mod) => {
      expect(mod.isWebauthnEnabled()).toBe(true);
    });
  });
});