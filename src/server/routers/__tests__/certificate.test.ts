import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t, mockCollectCertRefs } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t, mockCollectCertRefs: vi.fn() };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decrypt: vi.fn((val: string) => val.replace("enc:", "")),
}));

vi.mock("@/server/services/cert-expiry-checker", () => ({
  parseCertExpiry: vi.fn().mockReturnValue(new Date("2026-12-31T00:00:00Z")),
  daysUntilExpiry: vi.fn().mockReturnValue(274),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_: unknown, config: unknown) => config),
}));

vi.mock("@/server/services/secret-resolver", () => ({
  collectCertRefs: mockCollectCertRefs,
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { certificateRouter } from "@/server/routers/certificate";
import { encrypt } from "@/server/services/crypto";
import { parseCertExpiry } from "@/server/services/cert-expiry-checker";
import { decryptNodeConfig } from "@/server/services/config-crypto";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(certificateRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "EDITOR",
  teamId: "team-1",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const validPemBase64 = Buffer.from("-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----").toString("base64");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("certificateRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    mockCollectCertRefs.mockReset();
    mockCollectCertRefs.mockImplementation((config: Record<string, unknown>) => {
      const refs = new Set<string>();
      const values = JSON.stringify(config);
      if (values.includes("CERT[client-cert]")) refs.add("client-cert");
      if (values.includes("CERT[other-cert]")) refs.add("other-cert");
      return refs;
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns certs sorted by daysUntilExpiry (soonest first)", async () => {
      prismaMock.certificate.findMany.mockResolvedValue([
        {
          id: "c1",
          name: "cert-a",
          filename: "a.pem",
          fileType: "cert",
          createdAt: new Date(),
          encryptedData: "enc:pem-data-a",
        },
        {
          id: "c2",
          name: "cert-b",
          filename: "b.pem",
          fileType: "key",
          createdAt: new Date(),
          encryptedData: "enc:pem-data-b",
        },
      ] as never);

      // cert-a (cert type) gets expiry, cert-b (key type) does not
      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toHaveLength(2);
      // cert with expiry should come first, key (null) should come last
      expect(result[0].name).toBe("cert-a");
      expect(result[0].daysUntilExpiry).toBe(274);
      expect(result[1].name).toBe("cert-b");
      expect(result[1].daysUntilExpiry).toBeNull();
    });

    it("handles decrypt failure gracefully (null expiry)", async () => {
      vi.mocked(parseCertExpiry).mockImplementationOnce(() => {
        throw new Error("corrupt");
      });

      prismaMock.certificate.findMany.mockResolvedValue([
        {
          id: "c1",
          name: "bad-cert",
          filename: "bad.pem",
          fileType: "cert",
          createdAt: new Date(),
          encryptedData: "enc:corrupt",
        },
      ] as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result[0].expiryDate).toBeNull();
      expect(result[0].daysUntilExpiry).toBeNull();
    });
  });

  // ─── upload ───────────────────────────────────────────────────────────────

  describe("upload", () => {
    it("uploads a valid PEM certificate", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue(null as never);
      const created = {
        id: "c-new",
        name: "my-cert",
        filename: "cert.pem",
        fileType: "cert",
        createdAt: new Date(),
      };
      prismaMock.certificate.create.mockResolvedValue(created as never);

      const result = await caller.upload({
        environmentId: "env-1",
        name: "my-cert",
        filename: "cert.pem",
        fileType: "cert",
        dataBase64: validPemBase64,
      });

      expect(result).toMatchObject({ id: "c-new", name: "my-cert" });
      expect(encrypt).toHaveBeenCalled();
    });

    it("rejects files exceeding 100KB size limit", async () => {
      // Create a base64 string that decodes to >100KB
      const largeContent = "-----BEGIN CERTIFICATE-----\n" + "A".repeat(120 * 1024) + "\n-----END CERTIFICATE-----";
      const largeBase64 = Buffer.from(largeContent).toString("base64");

      await expect(
        caller.upload({
          environmentId: "env-1",
          name: "big-cert",
          filename: "big.pem",
          fileType: "cert",
          dataBase64: largeBase64,
        }),
      ).rejects.toThrow("exceeds 100KB limit");
    });

    it("rejects invalid PEM format", async () => {
      const notPem = Buffer.from("this is not a PEM file").toString("base64");

      await expect(
        caller.upload({
          environmentId: "env-1",
          name: "bad-cert",
          filename: "bad.pem",
          fileType: "cert",
          dataBase64: notPem,
        }),
      ).rejects.toThrow("Invalid certificate format");
    });

    it("throws CONFLICT for duplicate name in same environment", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue({ id: "existing" } as never);

      await expect(
        caller.upload({
          environmentId: "env-1",
          name: "my-cert",
          filename: "cert.pem",
          fileType: "cert",
          dataBase64: validPemBase64,
        }),
      ).rejects.toThrow("A certificate with this name already exists");
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes certificate by id", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue({
        id: "c1",
        environmentId: "env-1",
      } as never);
      prismaMock.certificate.delete.mockResolvedValue({} as never);

      const result = await caller.delete({ id: "c1", environmentId: "env-1" });

      expect(result).toEqual({ deleted: true });
      expect(prismaMock.certificate.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    });

    it("throws NOT_FOUND when certificate does not exist", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.delete({ id: "c-missing", environmentId: "env-1" }),
      ).rejects.toThrow("Certificate not found");
    });

    it("throws NOT_FOUND when environmentId does not match", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue({
        id: "c1",
        environmentId: "env-other",
      } as never);

      await expect(
        caller.delete({ id: "c1", environmentId: "env-1" }),
      ).rejects.toThrow("Certificate not found");
    });
  });

  // ─── usage ─────────────────────────────────────────────────────────────────

  describe("usage", () => {
    it("returns empty result when certificate does not exist", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue(null as never);

      const result = await caller.usage({ certificateId: "missing", environmentId: "env-1" });

      expect(result).toEqual({ count: 0, pipelineCount: 0, refs: [] });
    });

    it("returns refs from pipeline nodes that reference the certificate", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue({
        id: "c1",
        name: "client-cert",
        environmentId: "env-1",
      } as never);
      prismaMock.pipelineNode.findMany.mockResolvedValue([
        {
          id: "node-1",
          componentType: "kafka",
          config: { tls: { crt_file: "CERT[client-cert]" } },
          pipeline: {
            id: "p-1",
            name: "TLS Pipeline",
            environment: { id: "env-1", name: "production" },
          },
        },
        {
          id: "node-2",
          componentType: "http",
          config: { tls: { crt_file: "CERT[other-cert]" } },
          pipeline: {
            id: "p-2",
            name: "Other Pipeline",
            environment: { id: "env-1", name: "production" },
          },
        },
      ] as never);

      const result = await caller.usage({ certificateId: "c1", environmentId: "env-1" });

      expect(result).toEqual({
        count: 1,
        pipelineCount: 1,
        refs: [
          expect.objectContaining({
            id: "node-1",
            componentType: "kafka",
            pipeline: expect.objectContaining({
              name: "TLS Pipeline",
              environment: expect.objectContaining({ name: "production" }),
            }),
          }),
        ],
      });
    });

    it("scans decrypted node config before collecting cert refs", async () => {
      vi.mocked(decryptNodeConfig).mockImplementationOnce((_: unknown, config: unknown) => {
        const record = config as Record<string, unknown>;
        return { ...record, tls: { crt_file: "CERT[client-cert]" } };
      });
      prismaMock.certificate.findUnique.mockResolvedValue({
        id: "c1",
        name: "client-cert",
        environmentId: "env-1",
      } as never);
      prismaMock.pipelineNode.findMany.mockResolvedValue([
        {
          id: "node-encrypted",
          componentType: "vector_sink",
          config: { tls: { crt_file: "enc:ciphertext" } },
          pipeline: {
            id: "p-1",
            name: "Encrypted TLS Pipeline",
            environment: { id: "env-1", name: "production" },
          },
        },
      ] as never);

      const result = await caller.usage({ certificateId: "c1", environmentId: "env-1" });

      expect(decryptNodeConfig).toHaveBeenCalled();
      expect(mockCollectCertRefs).toHaveBeenCalledWith({ tls: { crt_file: "CERT[client-cert]" } });
      expect(result.count).toBe(1);
      expect(result.pipelineCount).toBe(1);
      expect(result.refs.map((ref: { id: string }) => ref.id)).toEqual(["node-encrypted"]);
    });
  });

  // ─── getData ──────────────────────────────────────────────────────────────

  describe("getData", () => {
    it("returns decrypted certificate data", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue({
        id: "c1",
        environmentId: "env-1",
        encryptedData: "enc:pem-contents",
        filename: "cert.pem",
      } as never);

      const result = await caller.getData({ id: "c1", environmentId: "env-1" });

      expect(result).toEqual({ data: "pem-contents", filename: "cert.pem" });
    });

    it("throws NOT_FOUND when certificate does not exist", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.getData({ id: "c-missing", environmentId: "env-1" }),
      ).rejects.toThrow("Certificate not found");
    });

    it("throws NOT_FOUND when environmentId does not match", async () => {
      prismaMock.certificate.findUnique.mockResolvedValue({
        id: "c1",
        environmentId: "env-other",
        encryptedData: "enc:data",
        filename: "cert.pem",
      } as never);

      await expect(
        caller.getData({ id: "c1", environmentId: "env-1" }),
      ).rejects.toThrow("Certificate not found");
    });
  });

  // ─── certificate bundles ──────────────────────────────────────────────────

  describe("certificate bundles", () => {
    it("lists bundles with linked certificate metadata", async () => {
      prismaMock.certificateBundle.findMany.mockResolvedValue([
        {
          id: "bundle-1",
          name: "mtls-prod",
          environmentId: "env-1",
          caId: "ca-1",
          certId: "cert-1",
          keyId: "key-1",
          createdAt: new Date("2026-05-01T00:00:00Z"),
          updatedAt: new Date("2026-05-02T00:00:00Z"),
          ca: { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca" },
          cert: { id: "cert-1", name: "client-cert", filename: "client.pem", fileType: "cert" },
          key: { id: "key-1", name: "client-key", filename: "client.key", fileType: "key" },
        },
      ] as never);

      const result = await caller.bundleList({ environmentId: "env-1" });

      expect(result).toEqual([
        expect.objectContaining({
          id: "bundle-1",
          name: "mtls-prod",
          ca: expect.objectContaining({ name: "root-ca" }),
          cert: expect.objectContaining({ name: "client-cert" }),
          key: expect.objectContaining({ name: "client-key" }),
        }),
      ]);
      expect(prismaMock.certificateBundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { environmentId: "env-1" } }),
      );
    });

    it("gets a bundle by id within the environment", async () => {
      prismaMock.certificateBundle.findUnique.mockResolvedValue({
        id: "bundle-1",
        name: "mtls-prod",
        environmentId: "env-1",
        caId: "ca-1",
        certId: null,
        keyId: null,
        createdAt: new Date("2026-05-01T00:00:00Z"),
        updatedAt: new Date("2026-05-02T00:00:00Z"),
        ca: { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca" },
        cert: null,
        key: null,
      } as never);

      const result = await caller.bundleGet({ id: "bundle-1", environmentId: "env-1" });

      expect(result).toEqual(
        expect.objectContaining({
          id: "bundle-1",
          name: "mtls-prod",
          ca: expect.objectContaining({ name: "root-ca" }),
          cert: null,
          key: null,
        }),
      );
    });

    it("creates a bundle after validating linked certificate types", async () => {
      prismaMock.certificate.findMany.mockResolvedValue([
        { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca", environmentId: "env-1" },
        { id: "cert-1", name: "client-cert", filename: "client.pem", fileType: "cert", environmentId: "env-1" },
        { id: "key-1", name: "client-key", filename: "client.key", fileType: "key", environmentId: "env-1" },
      ] as never);
      prismaMock.certificateBundle.findUnique.mockResolvedValue(null as never);
      prismaMock.certificateBundle.create.mockResolvedValue({
        id: "bundle-1",
        name: "mtls-prod",
        environmentId: "env-1",
        caId: "ca-1",
        certId: "cert-1",
        keyId: "key-1",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        updatedAt: new Date("2026-05-02T00:00:00Z"),
        ca: { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca" },
        cert: { id: "cert-1", name: "client-cert", filename: "client.pem", fileType: "cert" },
        key: { id: "key-1", name: "client-key", filename: "client.key", fileType: "key" },
      } as never);

      const result = await caller.bundleCreate({
        environmentId: "env-1",
        name: "mtls-prod",
        caId: "ca-1",
        certId: "cert-1",
        keyId: "key-1",
      });

      expect(result).toEqual(expect.objectContaining({ id: "bundle-1", name: "mtls-prod" }));
      expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ["ca-1", "cert-1", "key-1"] } } }),
      );
    });

    it("rejects bundle creation when a linked certificate has the wrong file type", async () => {
      prismaMock.certificate.findMany.mockResolvedValue([
        { id: "cert-1", name: "client-cert", filename: "client.pem", fileType: "cert", environmentId: "env-1" },
      ] as never);
      prismaMock.certificateBundle.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.bundleCreate({
          environmentId: "env-1",
          name: "bad-bundle",
          caId: "cert-1",
          certId: null,
          keyId: null,
        }),
      ).rejects.toThrow("Selected CA certificate is invalid");
    });

    it("updates a bundle after validating replacement certificates", async () => {
      prismaMock.certificateBundle.findUnique
        .mockResolvedValueOnce({
          id: "bundle-1",
          environmentId: "env-1",
          name: "mtls-prod",
        } as never)
        .mockResolvedValueOnce(null as never);
      prismaMock.certificate.findMany.mockResolvedValue([
        { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca", environmentId: "env-1" },
        { id: "key-2", name: "next-key", filename: "next.key", fileType: "key", environmentId: "env-1" },
      ] as never);
      prismaMock.certificateBundle.update.mockResolvedValue({
        id: "bundle-1",
        name: "mtls-prod",
        environmentId: "env-1",
        caId: "ca-1",
        certId: null,
        keyId: "key-2",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        updatedAt: new Date("2026-05-03T00:00:00Z"),
        ca: { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca" },
        cert: null,
        key: { id: "key-2", name: "next-key", filename: "next.key", fileType: "key" },
      } as never);

      const result = await caller.bundleUpdate({
        id: "bundle-1",
        environmentId: "env-1",
        name: "mtls-prod",
        caId: "ca-1",
        certId: null,
        keyId: "key-2",
      });

      expect(result).toEqual(expect.objectContaining({ keyId: "key-2" }));
      expect(prismaMock.certificateBundle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bundle-1" },
          data: expect.objectContaining({ keyId: "key-2" }),
        }),
      );
    });

    it("deletes a bundle by id", async () => {
      prismaMock.certificateBundle.findUnique.mockResolvedValue({
        id: "bundle-1",
        environmentId: "env-1",
      } as never);
      prismaMock.certificateBundle.delete.mockResolvedValue({} as never);

      const result = await caller.bundleDelete({ id: "bundle-1", environmentId: "env-1" });

      expect(result).toEqual({ deleted: true });
      expect(prismaMock.certificateBundle.delete).toHaveBeenCalledWith({ where: { id: "bundle-1" } });
    });
  });

});
