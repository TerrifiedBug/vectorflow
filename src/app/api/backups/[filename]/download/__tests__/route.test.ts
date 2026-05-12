import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

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
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as never);
    fsMock.access.mockRejectedValue(new Error("missing"));
  });

  it("returns 410 with a storage removal message for orphaned backup records", async () => {
    prismaMock.backupRecord.findFirst
      .mockResolvedValueOnce(null) // no success record
      .mockResolvedValueOnce({ id: "backup-1" } as never); // orphaned record found

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ filename: "vectorflow-orphaned.dump" }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "This backup's file has been removed from storage. The record is marked as orphaned.",
    });
    expect(prismaMock.backupRecord.findFirst).toHaveBeenNthCalledWith(2, {
      where: { filename: "vectorflow-orphaned.dump", status: "orphaned" },
      select: { id: true },
    });
  });

  it("returns 404 for unknown missing backup files", async () => {
    prismaMock.backupRecord.findFirst
      .mockResolvedValueOnce(null) // no success record
      .mockResolvedValueOnce(null); // no orphaned record

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ filename: "unknown.dump" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Backup not found" });
  });

  it("marks success record as orphaned and returns 410 when local file is missing", async () => {
    // Record exists with status=success but file is gone
    prismaMock.backupRecord.findFirst.mockResolvedValueOnce({
      id: "backup-success",
      storageLocation: "/backups/vectorflow-gone.dump",
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
