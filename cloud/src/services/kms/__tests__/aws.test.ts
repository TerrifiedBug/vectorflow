import { describe, it, expect, vi } from "vitest";

import { AwsKmsProvider, type AwsKmsClientLike } from "../aws";

function fakeClient(overrides: Partial<AwsKmsClientLike> = {}): AwsKmsClientLike {
  return {
    generateDataKey: vi.fn().mockResolvedValue({
      Plaintext: new Uint8Array(32).fill(0x42),
      CiphertextBlob: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    }),
    decrypt: vi.fn().mockResolvedValue({
      Plaintext: new Uint8Array(32).fill(0x42),
    }),
    encrypt: vi.fn().mockResolvedValue({
      CiphertextBlob: new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
    }),
    scheduleKeyDeletion: vi.fn().mockResolvedValue({}),
    describeKey: vi.fn().mockResolvedValue({
      KeyMetadata: { KeyId: "alias/vf-cloud", Enabled: true },
    }),
    ...overrides,
  };
}

describe("AwsKmsProvider construction", () => {
  it("throws when region or keyId missing", () => {
    expect(
      () =>
        new AwsKmsProvider({
          region: "",
          keyId: "alias/vf-cloud",
          client: fakeClient(),
        }),
    ).toThrow(/region/);
    expect(
      () =>
        new AwsKmsProvider({
          region: "us-east-1",
          keyId: "",
          client: fakeClient(),
        }),
    ).toThrow(/keyId/);
  });

  it("describeKey returns provider=aws-kms and a redacted keyId", () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId:
        "arn:aws:kms:us-east-1:123456789012:key/0a000000-1111-2222-3333-444455556666",
      client: fakeClient(),
    });
    const d = p.describeKey();
    expect(d.provider).toBe("aws-kms");
    expect(d.keyId).toContain("0a000000…");
    expect(d.keyId).not.toContain("4444"); // tail uuid redacted
  });
});

describe("generateDataKey", () => {
  it("calls KMS with the correct EncryptionContext + KeySpec", async () => {
    const c = fakeClient();
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: c,
    });

    const r = await p.generateDataKey("org-a");
    expect(c.generateDataKey).toHaveBeenCalledWith({
      KeyId: "alias/vf-cloud",
      KeySpec: "AES_256",
      EncryptionContext: { orgId: "org-a", purpose: "data-encryption-key" },
    });
    expect(r.plaintext).toHaveLength(32);
    expect(r.ciphertext).toBeTypeOf("string");
  });

  it("throws when KMS returns empty Plaintext or CiphertextBlob", async () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: fakeClient({
        generateDataKey: vi.fn().mockResolvedValue({}),
      }),
    });
    await expect(p.generateDataKey("org-a")).rejects.toThrow(
      /empty Plaintext/,
    );
  });

  it("requires orgId", async () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: fakeClient(),
    });
    await expect(p.generateDataKey("")).rejects.toThrow(/orgId/);
  });
});

describe("unwrapDataKey", () => {
  it("forwards EncryptionContext and decodes base64 ciphertext", async () => {
    const c = fakeClient();
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: c,
    });
    const r = await p.unwrapDataKey("3q2+7w==", "org-b");
    expect(c.decrypt).toHaveBeenCalledWith({
      CiphertextBlob: expect.any(Uint8Array),
      EncryptionContext: { orgId: "org-b", purpose: "data-encryption-key" },
      GrantTokens: undefined,
    });
    expect(r).toHaveLength(32);
  });

  it("passes a grant token when supplied (break-glass workflow)", async () => {
    const c = fakeClient();
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: c,
    });
    await p.unwrapDataKey("3q2+7w==", "org-b", "grant-token-xyz");
    expect(c.decrypt).toHaveBeenCalledWith(
      expect.objectContaining({ GrantTokens: ["grant-token-xyz"] }),
    );
  });

  it("rejects when KMS returns empty Plaintext (cross-tenant EC mismatch)", async () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: fakeClient({ decrypt: vi.fn().mockResolvedValue({}) }),
    });
    await expect(p.unwrapDataKey("ct", "org-b")).rejects.toThrow(
      /empty Plaintext/,
    );
  });
});

describe("rewrapDataKey", () => {
  it("rejects non-32-byte plaintext", async () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: fakeClient(),
    });
    await expect(
      p.rewrapDataKey(Buffer.alloc(16, 0x42), "org-a"),
    ).rejects.toThrow(/32-byte/);
  });

  it("encrypts with the same EncryptionContext as wrap", async () => {
    const c = fakeClient();
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: c,
    });
    await p.rewrapDataKey(Buffer.alloc(32, 0x42), "org-a");
    expect(c.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        EncryptionContext: { orgId: "org-a", purpose: "data-encryption-key" },
      }),
    );
  });
});

describe("scheduleKeyDeletion", () => {
  it("uses 7-day pending window by default", async () => {
    const c = fakeClient();
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: c,
    });
    await p.scheduleKeyDeletion("org-a");
    expect(c.scheduleKeyDeletion).toHaveBeenCalledWith({
      KeyId: "alias/vf-cloud",
      PendingWindowInDays: 7,
    });
  });
});

describe("healthCheck", () => {
  it("returns ok:true when KMS reports the CMK enabled", async () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: fakeClient(),
    });
    const r = await p.healthCheck();
    expect(r.ok).toBe(true);
    expect(r.keyId).toBe("alias/vf-cloud");
  });

  it("returns ok:false when the CMK is disabled", async () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: fakeClient({
        describeKey: vi.fn().mockResolvedValue({
          KeyMetadata: { KeyId: "alias/vf-cloud", Enabled: false },
        }),
      }),
    });
    const r = await p.healthCheck();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disabled/i);
  });

  it("returns ok:false with the error message when KMS throws", async () => {
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: fakeClient({
        describeKey: vi.fn().mockRejectedValue(new Error("rate-limited")),
      }),
    });
    const r = await p.healthCheck();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rate-limited/);
  });

  it("short-circuits on an already-aborted signal without calling KMS", async () => {
    const c = fakeClient();
    const p = new AwsKmsProvider({
      region: "us-east-1",
      keyId: "alias/vf-cloud",
      client: c,
    });
    const ac = new AbortController();
    ac.abort();
    const r = await p.healthCheck({ signal: ac.signal });
    expect(r.ok).toBe(false);
    expect(c.describeKey).not.toHaveBeenCalled();
  });
});
