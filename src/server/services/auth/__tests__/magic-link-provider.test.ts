import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeMagicLink: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/auth/magic-link", () => ({
  consumeMagicLink: mocks.consumeMagicLink,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(), // kept for type compat; not used after case-insensitive migration
      findFirst: mocks.userFindFirst,
      create: mocks.userCreate,
    },
  },
}));
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  errorLog: vi.fn(),
}));

import { authorizeMagicLink } from "../magic-link-provider";

describe("authorizeMagicLink", () => {
  beforeEach(() => {
    mocks.consumeMagicLink.mockReset();
    mocks.userFindFirst.mockReset();
    mocks.userCreate.mockReset();
    mocks.writeAuditLog.mockClear();
  });

  it("returns the existing user on a valid token", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "alice@example.test",
      organizationId: "org-a",
    });
    mocks.userFindFirst.mockResolvedValue({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
      lockedAt: null,
    });

    const result = await authorizeMagicLink({ token: "fake-base64url-token" }, "org-a");

    expect(result).toEqual({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
    });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "auth.login_succeeded",
        entityId: "magic-link",
      }),
    );
  });

  it("provisions a new user when the verified email is unknown", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "newcomer@example.test",
      organizationId: "org-a",
    });
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: "user-new",
      email: "newcomer@example.test",
      name: "newcomer",
      image: null,
      lockedAt: null,
    });

    const result = await authorizeMagicLink({ token: "fake-base64url-token" }, "org-a");

    expect(result?.id).toBe("user-new");
    expect(mocks.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "newcomer@example.test",
          authMethod: "MAGIC_LINK",
        }),
      }),
    );
    // Two audit-log writes: provisioned + login_succeeded.
    expect(mocks.writeAuditLog.mock.calls).toHaveLength(2);
    const actions = mocks.writeAuditLog.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("auth.user_provisioned");
    expect(actions).toContain("auth.login_succeeded");
  });

  it("returns null on a not_found token", async () => {
    mocks.consumeMagicLink.mockResolvedValue({ ok: false, reason: "not_found" });
    const result = await authorizeMagicLink({
      token: "fake-base64url-token",
    });
    expect(result).toBeNull();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  it("returns null on already_used / expired / wrong_organization", async () => {
    for (const reason of ["already_used", "expired", "wrong_organization"] as const) {
      mocks.consumeMagicLink.mockResolvedValue({ ok: false, reason });
      const result = await authorizeMagicLink({
        token: "fake-base64url-token",
      });
      expect(result).toBeNull();
    }
  });

  it("returns null when the user is locked", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "alice@example.test",
      organizationId: "org-a",
    });
    mocks.userFindFirst.mockResolvedValue({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
      lockedAt: new Date(),
    });
    const result = await authorizeMagicLink({ token: "fake-base64url-token" }, "org-a");
    expect(result).toBeNull();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns null when the user has TOTP enabled (codex P1: magic-link cannot bypass 2FA)", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "alice@example.test",
      organizationId: "org-a",
    });
    mocks.userFindFirst.mockResolvedValue({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
      lockedAt: null,
      totpEnabled: true,
    });
    const result = await authorizeMagicLink({ token: "fake-base64url-token" }, "org-a");
    expect(result).toBeNull();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.login_denied",
        metadata: expect.objectContaining({
          reason: "totp_enabled_magic_link_disallowed",
        }),
      }),
    );
  });

  it("returns null for a too-short token (rejects empty payloads early)", async () => {
    const result = await authorizeMagicLink({ token: "x" });
    expect(result).toBeNull();
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
  });

  it("returns null when consumeMagicLink throws unexpectedly", async () => {
    mocks.consumeMagicLink.mockRejectedValue(new Error("db unreachable"));
    const result = await authorizeMagicLink({
      token: "fake-base64url-token",
    });
    expect(result).toBeNull();
  });

  it("refuses when no expectedOrganizationId override is supplied (host-bound binding required)", async () => {
    // The pure helper requires the caller (NextAuth-bound wrapper or
    // test) to pin the expected org. Without it, the helper refuses
    // rather than skipping the cross-org check.
    const result = await authorizeMagicLink({ token: "tok-no-org" });
    expect(result).toBeNull();
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
  });

  it("forwards the expected organizationId override verbatim to consumeMagicLink", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "a@example.test",
      organizationId: "org-a",
    });
    mocks.userFindFirst.mockResolvedValue({
      id: "u",
      email: "a@example.test",
      name: null,
      image: null,
      lockedAt: null,
    });
    const result = await authorizeMagicLink({ token: "tok-with-org" }, "org-a");
    expect(result).not.toBeNull();
    expect(mocks.consumeMagicLink).toHaveBeenLastCalledWith({
      token: "tok-with-org",
      expectedOrganizationId: "org-a",
    });
  });

  it("ignores credentials.organizationId; only the override is honoured", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "a@example.test",
      organizationId: "org-b",
    });
    mocks.userFindFirst.mockResolvedValue({
      id: "u",
      email: "a@example.test",
      name: null,
      image: null,
      lockedAt: null,
    });

    // Even with an attacker-controlled organizationId in credentials,
    // the provider trusts ONLY the host-derived override.
    await authorizeMagicLink(
      { token: "tok-with-org", organizationId: "org-attacker" },
      "org-b",
    );
    expect(mocks.consumeMagicLink).toHaveBeenLastCalledWith({
      token: "tok-with-org",
      expectedOrganizationId: "org-b",
    });
  });

  it("refuses when credentials carry organizationId but no override is passed", async () => {
    // credentials.organizationId is intentionally ignored; the absence
    // of the host-derived override is what disqualifies the redeem.
    const result = await authorizeMagicLink({
      token: "tok-empty-org",
      organizationId: "",
    });
    expect(result).toBeNull();
  });
});
