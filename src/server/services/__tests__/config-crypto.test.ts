import { describe, it, expect, vi } from "vitest";

vi.mock("../crypto", () => ({
  encrypt: vi.fn((v: string) => `ENC[${v}]`),
  decrypt: vi.fn((v: string) => {
    const match = v.match(/^ENC\[(.+)]$/);
    if (match) return match[1];
    throw new Error("Decryption failed");
  }),
}));

vi.mock("@/lib/vector/catalog", () => ({
  findComponentDef: vi.fn((type: string) => {
    if (type === "test_source") {
      return {
        configSchema: {
          type: "object",
          properties: {
            host: { type: "string" },
            password: { type: "string", sensitive: true },
            token: { type: "string" },
            nested: {
              type: "object",
              properties: {
                secret_key: { type: "string", sensitive: true },
                name: { type: "string" },
              },
            },
          },
        },
      };
    }
    if (type === "no_schema") return undefined;
    return { configSchema: { type: "object", properties: {} } };
  }),
}));

import { encryptNodeConfig, decryptNodeConfig } from "../config-crypto";

describe("config-crypto", () => {
  describe("encryptNodeConfig", () => {
    it("encrypts fields marked sensitive in schema", () => {
      const result = encryptNodeConfig("test_source", {
        host: "localhost",
        password: "my-pass",
      });
      expect(result.host).toBe("localhost");
      expect(result.password).toBe("enc:ENC[my-pass]");
    });

    it("encrypts fields matching sensitive name patterns", () => {
      const result = encryptNodeConfig("test_source", {
        host: "localhost",
        token: "my-token",
      });
      expect(result.host).toBe("localhost");
      expect(result.token).toBe("enc:ENC[my-token]");
    });

    it("encrypts nested sensitive fields", () => {
      const result = encryptNodeConfig("test_source", {
        nested: { secret_key: "top-secret", name: "test" },
      });
      expect((result.nested as Record<string, unknown>).secret_key).toBe(
        "enc:ENC[top-secret]",
      );
      expect((result.nested as Record<string, unknown>).name).toBe("test");
    });

    it("does not double-encrypt already-encrypted values", () => {
      const result = encryptNodeConfig("test_source", {
        password: "enc:already-encrypted",
      });
      expect(result.password).toBe("enc:already-encrypted");
    });

    it("skips null and undefined values", () => {
      const result = encryptNodeConfig("test_source", {
        password: null,
        host: "localhost",
      });
      expect(result.password).toBeNull();
      expect(result.host).toBe("localhost");
    });

    it("skips empty string values", () => {
      const result = encryptNodeConfig("test_source", {
        password: "",
      });
      expect(result.password).toBe("");
    });

    it("returns config unchanged for unknown component type", () => {
      const config = { password: "secret" };
      const result = encryptNodeConfig("no_schema", config);
      expect(result).toEqual(config);
    });
  });

  describe("decryptNodeConfig", () => {
    it("decrypts enc: prefixed values", () => {
      const result = decryptNodeConfig("test_source", {
        host: "localhost",
        password: "enc:ENC[my-pass]",
      });
      expect(result.host).toBe("localhost");
      expect(result.password).toBe("my-pass");
    });

    it("leaves non-encrypted values unchanged", () => {
      const result = decryptNodeConfig("test_source", {
        password: "plaintext",
      });
      expect(result.password).toBe("plaintext");
    });

    it("leaves value as-is if decryption fails", () => {
      const result = decryptNodeConfig("test_source", {
        password: "enc:bad-data",
      });
      expect(result.password).toBe("enc:bad-data");
    });

    it("round-trips with encryptNodeConfig", () => {
      const original = {
        host: "localhost",
        password: "my-secret",
        nested: { secret_key: "nested-secret", name: "test" },
      };
      const encrypted = encryptNodeConfig("test_source", original);
      const decrypted = decryptNodeConfig("test_source", encrypted);
      expect(decrypted).toEqual(original);
    });
  });
});
