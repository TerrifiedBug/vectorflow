import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requireSuperAdmin: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decrypt: vi.fn((val: string) => val.replace("enc:", "")),
}));

vi.mock("@/server/services/cert-expiry-checker", () => ({
  parseCertExpiry: vi.fn().mockReturnValue(new Date("2026-12-31T00:00:00Z")),
  daysUntilExpiry: vi.fn().mockReturnValue(274),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { certificateRouter } from "@/server/routers/certificate";
import { encrypt } from "@/server/services/crypto";
import { parseCertExpiry, daysUntilExpiry } from "@/server/services/cert-expiry-checker";

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
});
