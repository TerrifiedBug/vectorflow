import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("fs/promises", () => ({
  default: {
    access: vi.fn(),
    stat: vi.fn(),
  },
}));

vi.mock("fs", () => ({
  createReadStream: vi.fn(),
}));

import fs from "fs/promises";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const fsMock = fs as unknown as {
  access: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
};

describe("GET /api/backups/[filename]/download", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
    fsMock.access.mockRejectedValue(new Error("missing"));
  });

  it("returns 410 with a storage removal message for orphaned backup records", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValueOnce({
      id: "backup-1",
      organizationId: "default",
      storageLocation: null,
      status: "orphaned",
    } as never);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ filename: "vectorflow-orphaned.dump" }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "This backup's file has been removed from storage. The record is marked as orphaned.",
    });
  });

  it("returns 404 for unknown missing backup files", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ filename: "unknown.dump" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Backup not found" });
  });

  it("returns 403 when the caller is not an admin of the backup's organisation", async () => {
    // Backup belongs to org "tenant-b"; caller is not a member there.
    prismaMock.backupRecord.findFirst.mockResolvedValueOnce({
      id: "backup-b",
      organizationId: "tenant-b",
      storageLocation: "/backups/tenant-b.dump",
      status: "success",
    } as never);
    prismaMock.orgMember.findUnique.mockResolvedValue(null as never);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ filename: "tenant-b.dump" }),
    });

    expect(response.status).toBe(403);
    // Must not touch the filesystem or mutate the record on a denied request.
    expect(fsMock.access).not.toHaveBeenCalled();
    expect(prismaMock.backupRecord.update).not.toHaveBeenCalled();
  });

  it("marks success record as orphaned and returns 410 when local file is missing", async () => {
    // Record exists with status=success but file is gone
    prismaMock.backupRecord.findFirst.mockResolvedValueOnce({
      id: "backup-success",
      organizationId: "default",
      storageLocation: "/backups/vectorflow-gone.dump",
      status: "success",
    } as never);
    prismaMock.backupRecord.update.mockResolvedValue({} as never);

    // fs.access rejects — file is missing (ENOENT)
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    fsMock.access.mockRejectedValue(enoent);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ filename: "vectorflow-gone.dump" }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "This backup's file has been removed from storage. The record is marked as orphaned.",
    });

    // Should have updated the record to orphaned
    expect(prismaMock.backupRecord.update).toHaveBeenCalledWith({
      where: { id: "backup-success" },
      data: { status: "orphaned" },
    });
  });
});
