import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeMagicLink: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/auth/magic-link", () => ({
  consumeMagicLink: mocks.consumeMagicLink,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
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
    mocks.userFindUnique.mockReset();
    mocks.userCreate.mockReset();
    mocks.writeAuditLog.mockClear();
  });

  it("returns the existing user on a valid token", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "alice@example.test",
      organizationId: "org-a",
    });
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
      lockedAt: null,
    });

    const result = await authorizeMagicLink({
      token: "fake-base64url-token",
      organizationId: "org-a",
    });

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
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: "user-new",
      email: "newcomer@example.test",
      name: "newcomer",
      image: null,
      lockedAt: null,
    });

    const result = await authorizeMagicLink({
      token: "fake-base64url-token",
      organizationId: "org-a",
    });

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
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
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
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.test",
      name: "Alice",
      image: null,
      lockedAt: new Date(),
    });
    const result = await authorizeMagicLink({
      token: "fake-base64url-token",
    });
    expect(result).toBeNull();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
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

  it("requires organizationId; refuses redeem when missing (codex P1)", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "a@example.test",
      organizationId: "org-a",
    });
    mocks.userFindUnique.mockResolvedValue({
      id: "u",
      email: "a@example.test",
      name: null,
      image: null,
      lockedAt: null,
    });

    // Missing organizationId → reject without ever calling consumeMagicLink.
    const result = await authorizeMagicLink({ token: "tok-no-org" });
    expect(result).toBeNull();
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
  });

  it("passes expectedOrganizationId verbatim when supplied", async () => {
    mocks.consumeMagicLink.mockResolvedValue({
      ok: true,
      email: "a@example.test",
      organizationId: "org-b",
    });
    mocks.userFindUnique.mockResolvedValue({
      id: "u",
      email: "a@example.test",
      name: null,
      image: null,
      lockedAt: null,
    });

    await authorizeMagicLink({ token: "tok-with-org", organizationId: "org-b" });
    expect(mocks.consumeMagicLink).toHaveBeenLastCalledWith({
      token: "tok-with-org",
      expectedOrganizationId: "org-b",
    });
  });

  it("refuses redeem when organizationId is an empty string", async () => {
    const result = await authorizeMagicLink({
      token: "tok-empty-org",
      organizationId: "",
    });
    expect(result).toBeNull();
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
  });
});
