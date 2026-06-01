import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("../crypto", () => ({
  ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decryptForOrg: vi.fn(async (v: string) => `v3-decrypted:${v}`),
  encryptForOrg: vi.fn(async (v: string) => `v3:${v}`),
}));

import { prisma } from "@/lib/prisma";
import {
  resolveSecretRefs,
  resolveCertRefs,
  collectSecretRefs,
  collectCertRefs,
  convertSecretRefsToEnvVars,
  secretNameToEnvVar,
} from "../secret-resolver";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("secret-resolver", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    // Default mock for the environment lookup that resolveSecretRefs now
    // performs to derive the per-org DEK context. Individual tests override
    // when they need a specific shape.
    prismaMock.environment.findUnique.mockResolvedValue({
      organizationId: "default",
    } as never);
  });

  describe("collectSecretRefs", () => {
    it("returns empty set for config with no refs", () => {
      const refs = collectSecretRefs({ host: "localhost", port: 5432 });
      expect(refs.size).toBe(0);
    });

    it("collects top-level secret refs", () => {
      const refs = collectSecretRefs({
        host: "localhost",
        password: "SECRET[db-password]",
      });
      expect(refs).toEqual(new Set(["db-password"]));
    });

    it("collects nested secret refs", () => {
      const refs = collectSecretRefs({
        auth: { token: "SECRET[api-key]", user: "admin" },
      });
      expect(refs).toEqual(new Set(["api-key"]));
    });

    it("collects refs in arrays", () => {
      const refs = collectSecretRefs({
        headers: ["SECRET[header-token]", "plain-value"],
      });
      expect(refs).toEqual(new Set(["header-token"]));
    });

    it("deduplicates refs", () => {
      const refs = collectSecretRefs({
        a: "SECRET[key]",
        b: "SECRET[key]",
      });
      expect(refs.size).toBe(1);
    });
  });

  describe("collectCertRefs", () => {
    it("returns empty set for config with no refs", () => {
      const refs = collectCertRefs({ host: "localhost", port: 5432 });
      expect(refs.size).toBe(0);
    });

    it("collects top-level cert refs", () => {
      const refs = collectCertRefs({
        caFile: "CERT[ca-bundle]",
        host: "localhost",
      });
      expect(refs).toEqual(new Set(["ca-bundle"]));
    });

    it("collects nested cert refs in arrays", () => {
      const refs = collectCertRefs({
        tls: {
          files: ["CERT[client-cert]", "CERT[client-key]"],
        },
      });
      expect(refs).toEqual(new Set(["client-cert", "client-key"]));
    });
  });

  describe("secretNameToEnvVar", () => {
    it("converts simple name", () => {
      expect(secretNameToEnvVar("db-password")).toBe("VF_SECRET_DB_PASSWORD");
    });

    it("converts dotted name", () => {
      expect(secretNameToEnvVar("my.api.key")).toBe("VF_SECRET_MY_API_KEY");
    });

    it("converts already-uppercased name", () => {
      expect(secretNameToEnvVar("API_KEY")).toBe("VF_SECRET_API_KEY");
    });
  });

  describe("convertSecretRefsToEnvVars", () => {
    it("converts SECRET[name] to ${VF_SECRET_NAME}", () => {
      const result = convertSecretRefsToEnvVars({
        password: "SECRET[db-password]",
        host: "localhost",
      });
      expect(result).toEqual({
        password: "${VF_SECRET_DB_PASSWORD}",
        host: "localhost",
      });
    });

    it("converts nested refs", () => {
      const result = convertSecretRefsToEnvVars({
        auth: { token: "SECRET[api-key]" },
      });
      expect(result).toEqual({
        auth: { token: "${VF_SECRET_API_KEY}" },
      });
    });

    it("converts refs in arrays", () => {
      const result = convertSecretRefsToEnvVars({
        items: ["SECRET[key]", "plain"],
      });
      expect(result).toEqual({
        items: ["${VF_SECRET_KEY}", "plain"],
      });
    });

    it("returns config unchanged when no refs", () => {
      const config = { host: "localhost", port: 5432 };
      expect(convertSecretRefsToEnvVars(config)).toEqual(config);
    });
  });

  describe("resolveSecretRefs", () => {
    it("returns config unchanged when no refs", async () => {
      const config = { host: "localhost" };
      const result = await resolveSecretRefs(config, "env-1");
      expect(result).toEqual(config);
      expect(prismaMock.secret.findMany).not.toHaveBeenCalled();
    });

    it("resolves secret refs to decrypted values", async () => {
      prismaMock.secret.findMany.mockResolvedValue([
        { name: "db-pass", encryptedValue: "encrypted-val" },
      ] as never);

      const result = await resolveSecretRefs(
        { password: "SECRET[db-pass]", host: "localhost" },
        "env-1",
      );
      expect(result).toEqual({
        password: "decrypted:encrypted-val",
        host: "localhost",
      });
    });

    it("throws when a referenced secret is not found", async () => {
      prismaMock.secret.findMany.mockResolvedValue([] as never);

      await expect(
        resolveSecretRefs({ password: "SECRET[missing]" }, "env-1"),
      ).rejects.toThrow('Secret "missing" not found in environment');
    });

    it("resolves multiple refs across nested config", async () => {
      prismaMock.secret.findMany.mockResolvedValue([
        { name: "pass", encryptedValue: "enc-pass" },
        { name: "token", encryptedValue: "enc-token" },
      ] as never);

      const result = await resolveSecretRefs(
        {
          db: { password: "SECRET[pass]" },
          auth: { token: "SECRET[token]" },
        },
        "env-1",
      );
      expect(result).toEqual({
        db: { password: "decrypted:enc-pass" },
        auth: { token: "decrypted:enc-token" },
      });
    });
  });

  describe("resolveCertRefs", () => {
    it("returns config unchanged when no cert refs", async () => {
      const config = { host: "localhost" };
      const { config: result, certFiles } = await resolveCertRefs(
        config,
        "env-1",
        "/certs",
      );
      expect(result).toEqual(config);
      expect(certFiles).toEqual([]);
    });

    it("resolves cert refs to file paths and returns cert data", async () => {
      prismaMock.certificate.findMany.mockResolvedValue([
        { name: "tls-cert", filename: "server.crt", encryptedData: "enc-data" },
      ] as never);

      const { config: result, certFiles } = await resolveCertRefs(
        { tls_cert: "CERT[tls-cert]" },
        "env-1",
        "/certs",
      );
      expect(result).toEqual({ tls_cert: "/certs/server.crt" });
      expect(certFiles).toEqual([
        { name: "tls-cert", filename: "server.crt", data: "decrypted:enc-data" },
      ]);
    });

    it("resolves nested TLS cert refs without changing CERT semantics", async () => {
      prismaMock.certificate.findMany.mockResolvedValue([
        { name: "root-ca", filename: "root.pem", encryptedData: "ca-data" },
        { name: "client-cert", filename: "client.pem", encryptedData: "cert-data" },
        { name: "client-key", filename: "client.key", encryptedData: "key-data" },
      ] as never);

      const { config: result, certFiles } = await resolveCertRefs(
        {
          tls: {
            ca_file: "CERT[root-ca]",
            crt_file: "CERT[client-cert]",
            key_file: "CERT[client-key]",
          },
        },
        "env-1",
        "/certs",
      );

      expect(result).toEqual({
        tls: {
          ca_file: "/certs/root.pem",
          crt_file: "/certs/client.pem",
          key_file: "/certs/client.key",
        },
      });
      expect(certFiles).toEqual([
        { name: "root-ca", filename: "root.pem", data: "decrypted:ca-data" },
        { name: "client-cert", filename: "client.pem", data: "decrypted:cert-data" },
        { name: "client-key", filename: "client.key", data: "decrypted:key-data" },
      ]);
    });

    it("throws when a referenced cert is not found", async () => {
      prismaMock.certificate.findMany.mockResolvedValue([] as never);

      await expect(
        resolveCertRefs({ cert: "CERT[missing]" }, "env-1", "/certs"),
      ).rejects.toThrow('Certificate "missing" not found in environment');
    });
  });
});
