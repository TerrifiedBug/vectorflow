import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  finishAuthentication: vi.fn(),
  userFindUnique: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/webauthn", () => ({
  finishAuthentication: mocks.finishAuthentication,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}));
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  errorLog: vi.fn(),
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

describe("module-init production guard", () => {
  it("throws when NODE_ENV=production and VF_WEBAUTHN_RP_ID is not set", async () => {
    const savedRpId = process.env.VF_WEBAUTHN_RP_ID;
    try {
      delete process.env.VF_WEBAUTHN_RP_ID;
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      await expect(import("../webauthn-provider")).rejects.toThrow(
        "VF_WEBAUTHN_RP_ID must be set in production",
      );
    } finally {
      vi.unstubAllEnvs();
      if (savedRpId !== undefined) {
        process.env.VF_WEBAUTHN_RP_ID = savedRpId;
      } else {
        delete process.env.VF_WEBAUTHN_RP_ID;
      }
      vi.resetModules();
    }
  });

  it("does not throw when NODE_ENV=production and VF_WEBAUTHN_RP_ID is set", async () => {
    const savedRpId = process.env.VF_WEBAUTHN_RP_ID;
    try {
      process.env.VF_WEBAUTHN_RP_ID = "example.com";
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      await expect(import("../webauthn-provider")).resolves.toBeDefined();
    } finally {
      vi.unstubAllEnvs();
      if (savedRpId !== undefined) {
        process.env.VF_WEBAUTHN_RP_ID = savedRpId;
      } else {
        delete process.env.VF_WEBAUTHN_RP_ID;
      }
      vi.resetModules();
    }
  });

  it("does not throw in dev when VF_WEBAUTHN_RP_ID is not set", async () => {
    const savedRpId = process.env.VF_WEBAUTHN_RP_ID;
    // NODE_ENV=test is the vitest default — same guard applies (not production)
    try {
      delete process.env.VF_WEBAUTHN_RP_ID;
      vi.resetModules();
      await expect(import("../webauthn-provider")).resolves.toBeDefined();
    } finally {
      if (savedRpId !== undefined) {
        process.env.VF_WEBAUTHN_RP_ID = savedRpId;
      } else {
        delete process.env.VF_WEBAUTHN_RP_ID;
      }
      vi.resetModules();
    }
  });
});