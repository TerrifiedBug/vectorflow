import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  encryptForOrg: vi.fn(),
  decryptForOrg: vi.fn(),
}));

vi.mock("@/server/services/crypto", async (importActual) => {
  const actual = await importActual<typeof import("@/server/services/crypto")>();
  return {
    ...actual,
    encrypt: mocks.encrypt,
    decrypt: mocks.decrypt,
    encryptForOrg: mocks.encryptForOrg,
    decryptForOrg: mocks.decryptForOrg,
  };
});

import { ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import {
  encryptForOrgOrFallback,
  decryptForOrgOrFallback,
} from "../crypto-v3-callsite";

beforeEach(() => {
  mocks.encrypt.mockReset();
  mocks.decrypt.mockReset();
  mocks.encryptForOrg.mockReset();
  mocks.decryptForOrg.mockReset();
});

describe("encryptForOrgOrFallback", () => {
  it("uses v3 (encryptForOrg) when dataKeyCiphertext is set", async () => {
    mocks.encryptForOrg.mockResolvedValue("v3:ct");
    const out = await encryptForOrgOrFallback("secret", {
      orgId: "org-a",
      dataKeyCiphertext: "wrapped-dek",
      domain: ENCRYPTION_DOMAINS.TOTP,
      rowTable: "User",
      rowId: "user-1",
    });
    expect(out).toBe("v3:ct");
    expect(mocks.encryptForOrg).toHaveBeenCalledWith("secret", {
      orgId: "org-a",
      dataKeyCiphertext: "wrapped-dek",
      domain: ENCRYPTION_DOMAINS.TOTP,
      rowTable: "User",
      rowId: "user-1",
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it("falls back to v2 (encrypt) when dataKeyCiphertext is null", async () => {
    mocks.encrypt.mockReturnValue("v2:ct");
    const out = await encryptForOrgOrFallback("secret", {
      orgId: "org-a",
      dataKeyCiphertext: null,
      domain: ENCRYPTION_DOMAINS.TOTP,
      rowTable: "User",
      rowId: "user-1",
    });
    expect(out).toBe("v2:ct");
    expect(mocks.encrypt).toHaveBeenCalledWith("secret", ENCRYPTION_DOMAINS.TOTP);
    expect(mocks.encryptForOrg).not.toHaveBeenCalled();
  });
});

describe("decryptForOrgOrFallback", () => {
  it("uses v3 (decryptForOrg) for a v3-prefixed ciphertext", async () => {
    mocks.decryptForOrg.mockResolvedValue("plain");
    const out = await decryptForOrgOrFallback("v3:abc", {
      orgId: "org-a",
      dataKeyCiphertext: "wrapped-dek",
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "s-1",
    });
    expect(out).toBe("plain");
    expect(mocks.decryptForOrg).toHaveBeenCalledWith("v3:abc", {
      orgId: "org-a",
      dataKeyCiphertext: "wrapped-dek",
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "s-1",
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("uses v2 (decrypt) for a v2-prefixed ciphertext", async () => {
    mocks.decrypt.mockReturnValue("plain");
    const out = await decryptForOrgOrFallback("v2:def", {
      orgId: "org-a",
      dataKeyCiphertext: null,
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "s-1",
    });
    expect(out).toBe("plain");
    expect(mocks.decrypt).toHaveBeenCalledWith("v2:def", ENCRYPTION_DOMAINS.SECRETS);
    expect(mocks.decryptForOrg).not.toHaveBeenCalled();
  });

  it("uses v2 (decrypt) for an unprefixed (legacy v1) ciphertext", async () => {
    mocks.decrypt.mockReturnValue("plain");
    const out = await decryptForOrgOrFallback("legacy-no-prefix", {
      orgId: "org-a",
      dataKeyCiphertext: null,
      domain: ENCRYPTION_DOMAINS.GENERIC,
      rowTable: "Secret",
      rowId: "s-1",
    });
    expect(out).toBe("plain");
    expect(mocks.decrypt).toHaveBeenCalledWith(
      "legacy-no-prefix",
      ENCRYPTION_DOMAINS.GENERIC,
    );
  });

  it("hard-errors on v3 ciphertext when dataKeyCiphertext is null (KMS misconfig)", async () => {
    await expect(
      decryptForOrgOrFallback("v3:abc", {
        orgId: "org-a",
        dataKeyCiphertext: null,
        domain: ENCRYPTION_DOMAINS.SECRETS,
        rowTable: "Secret",
        rowId: "s-1",
      }),
    ).rejects.toThrow(/v3 ciphertext .* but no dataKeyCiphertext/);
    expect(mocks.decryptForOrg).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("v3 path uses Cloud DEK even when the org has it set and ciphertext is v3", async () => {
    mocks.decryptForOrg.mockResolvedValue("plain");
    await decryptForOrgOrFallback("v3:ct", {
      orgId: "org-cloud",
      dataKeyCiphertext: "wrapped-dek",
      domain: ENCRYPTION_DOMAINS.SECRETS,
      rowTable: "Secret",
      rowId: "s-2",
    });
    expect(mocks.decryptForOrg).toHaveBeenCalled();
  });
});
