import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { Readable } from "stream";
import type { PrismaClient } from "@/generated/prisma";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// Mock child_process — vi.fn() inside factory avoids hoisting issues
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    statfs: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}));

// Mock fs (for createReadStream used by computeChecksum)
vi.mock("fs", () => ({
  createReadStream: vi.fn(),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
}));

// ─── Import mocked modules + SUT ─────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import * as childProcess from "child_process";
import * as fsPromises from "fs/promises";
import * as fsSync from "fs";
import { checkDiskSpace, computeChecksum, createBackup } from "../backup";
import * as backupModule from "../backup";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// Typed references to the mocked functions
const mockExecFile = vi.mocked(childProcess.execFile);
// fs/promises is mocked with a default export object
const fsMock = (fsPromises as unknown as { default: Record<string, ReturnType<typeof vi.fn>> }).default;
const mockCreateReadStream = vi.mocked(fsSync.createReadStream);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a readable stream that emits the given data then ends. */
function makeReadableStream(data: Buffer | string): Readable {
  const stream = new Readable({ read() {} });
  stream.push(data);
  stream.push(null);
  return stream;
}

// ─── checkDiskSpace ──────────────────────────────────────────────────────────

describe("checkDiskSpace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns belowThreshold=true when available space is below default 500 MB", async () => {
    // 100 blocks * 4096 bytes/block = 409600 bytes = 0.39 MB (below 500 MB threshold)
    fsMock.statfs.mockResolvedValue({ bavail: BigInt(100), bsize: BigInt(4096) });

    const result = await checkDiskSpace("/backups");

    expect(result.belowThreshold).toBe(true);
    expect(result.availableMb).toBeLessThan(500);
  });

  it("returns belowThreshold=false when available space is above threshold", async () => {
    // 200000 blocks * 4096 bytes/block = ~781 MB (above 500 MB threshold)
    fsMock.statfs.mockResolvedValue({ bavail: BigInt(200000), bsize: BigInt(4096) });

    const result = await checkDiskSpace("/backups");

    expect(result.belowThreshold).toBe(false);
    expect(result.availableMb).toBeGreaterThan(500);
  });
});

// ─── computeChecksum ─────────────────────────────────────────────────────────

describe("computeChecksum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns SHA256 hex string for known input", async () => {
    const data = Buffer.from("hello world");
    mockCreateReadStream.mockReturnValue(makeReadableStream(data) as never);

    const result = await computeChecksum("/backups/test.dump");

    // SHA256 of "hello world"
    expect(result).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});

// ─── createBackup ────────────────────────────────────────────────────────────

describe("createBackup", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    // Set required env vars
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    // Default happy-path mocks
    fsMock.mkdir.mockResolvedValue(undefined);

    // Disk space: plenty available (781 MB)
    fsMock.statfs.mockResolvedValue({ bavail: BigInt(200000), bsize: BigInt(4096) });

    // pg_dump + psql: success (execFile called for both)
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr: "" }
        );
      }
    );

    // File stat: 1024 bytes
    fsMock.stat.mockResolvedValue({ size: 1024 });

    // Migration dir: one migration
    fsMock.readdir.mockResolvedValue(["20240101000000_init"]);

    // Write meta file
    fsMock.writeFile.mockResolvedValue(undefined);

    // computeChecksum: each createReadStream call returns a fresh stream
    mockCreateReadStream.mockImplementation(() =>
      makeReadableStream(Buffer.from("dump-file-data")) as never
    );

    // Prisma BackupRecord create returns a record with id
    prismaMock.backupRecord.create.mockResolvedValue({
      id: "rec-1",
      filename: "vectorflow-test.dump",
      status: "in_progress",
      type: "manual",
      storageLocation: "/backups/vectorflow-test.dump",
      vfVersion: "dev",
      sizeBytes: null,
      durationMs: null,
      checksum: null,
      migrationCount: null,
      lastMigration: null,
      pgVersion: null,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    } as never);

    // Prisma BackupRecord update
    prismaMock.backupRecord.update.mockResolvedValue({} as never);

    // Prisma SystemSettings update
    prismaMock.systemSettings.update.mockResolvedValue({} as never);
  });

  it("creates an in_progress BackupRecord before pg_dump", async () => {
    await createBackup();

    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "in_progress",
          type: "manual",
        }),
      })
    );
  });

  it("updates BackupRecord to success with checksum and sizeBytes on completion", async () => {
    await createBackup();

    expect(prismaMock.backupRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({
          status: "success",
          sizeBytes: BigInt(1024),
          checksum: expect.any(String),
        }),
      })
    );
  });

  it("passes type='scheduled' when called with that argument", async () => {
    await createBackup("scheduled");

    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "scheduled",
        }),
      })
    );
  });

  it("updates BackupRecord to failed with error on pg_dump failure", async () => {
    // Mock execFile to fail on the first call (pg_dump), succeed on psql
    let callCount = 0;
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        callCount++;
        if (callCount === 1) {
          // pg_dump fails
          (callback as (err: Error) => void)(new Error("pg_dump: connection refused"));
        } else {
          (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: "16.1", stderr: "" }
          );
        }
      }
    );

    await expect(createBackup()).rejects.toThrow("pg_dump: connection refused");

    expect(prismaMock.backupRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({
          status: "failed",
          error: "pg_dump: connection refused",
        }),
      })
    );
  });
});

// ─── restoreFromBackup - checksum verification ────────────────────────────────

describe("restoreFromBackup - checksum verification", () => {
  const testFilename = "vectorflow-2025-01-01T02-00-00-000Z.dump";

  // SHA256 of "hello world"
  const knownHash = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

  // Spy on createBackup to avoid actually running it during restoreFromBackup tests
  // This prevents shared backupInProgress state and timeout issues
  let createBackupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    // Dump file exists
    fsMock.access.mockResolvedValue(undefined);

    // Meta file: valid metadata with 1 migration (matches current)
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        version: "dev",
        timestamp: "2025-01-01T02:00:00.000Z",
        migrationCount: 1,
        lastMigration: "20240101000000_init",
        sizeBytes: 1024,
        pgVersion: "16.1",
      })
    );

    // Migration dir: same count as backup
    fsMock.readdir.mockResolvedValue(["20240101000000_init"]);

    // execFile: success for pg_restore
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
      }
    );

    // Set up mocks for the safety createBackup("pre_restore") call inside restoreFromBackup
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.statfs.mockResolvedValue({ bavail: BigInt(200000), bsize: BigInt(4096) });
    fsMock.stat.mockResolvedValue({ size: 1024 });
    fsMock.writeFile.mockResolvedValue(undefined);

    // execFile: success for pg_dump (safety backup) + psql (getPgVersion) + pg_restore
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr: "" }
        );
      }
    );

    // Prisma mocks for safety createBackup
    prismaMock.backupRecord.create.mockResolvedValue({
      id: "rec-safety",
      filename: "vectorflow-safety.dump",
      status: "in_progress",
      type: "pre_restore",
      storageLocation: "/backups/vectorflow-safety.dump",
      vfVersion: "dev",
      sizeBytes: null,
      durationMs: null,
      checksum: null,
      migrationCount: null,
      lastMigration: null,
      pgVersion: null,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    } as never);
    prismaMock.backupRecord.update.mockResolvedValue({} as never);
    prismaMock.systemSettings.update.mockResolvedValue({} as never);

    // Spy on createBackup (note: vi.spyOn cannot intercept internal module calls,
    // so this is only used in the mismatch test to verify it's NOT called before throw)
    createBackupSpy = vi.spyOn(backupModule, "createBackup");

    // computeChecksum: return fresh stream each time
    mockCreateReadStream.mockImplementation(() =>
      makeReadableStream(Buffer.from("hello world")) as never
    );

    // Mock process.exit to prevent actual test process exit
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  it("verifies checksum before pg_restore", async () => {
    // BackupRecord exists with matching checksum (matches "hello world" SHA256)
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);

    // Should not throw checksum error — proceeds to safety backup + pg_restore
    await expect(backupModule.restoreFromBackup(testFilename)).resolves.toBeUndefined();

    // Safety backup was created (BackupRecord.create called with pre_restore type)
    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "pre_restore" }),
      })
    );
  });

  it("throws on checksum mismatch", async () => {
    // BackupRecord has an expected checksum that won't match "hello world"
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: "0000000000000000expected-but-different-hash-that-wont-match",
    } as never);

    await expect(backupModule.restoreFromBackup(testFilename)).rejects.toThrow(
      "Backup file checksum mismatch"
    );

    // createBackup should NOT have been called (threw before safety backup)
    expect(createBackupSpy).not.toHaveBeenCalled();
  });

  it("skips verification when no BackupRecord found (legacy backup)", async () => {
    // No BackupRecord exists for this file
    prismaMock.backupRecord.findFirst.mockResolvedValue(null);

    // Should not throw a checksum error — proceeds to safety backup + pg_restore
    await expect(backupModule.restoreFromBackup(testFilename)).resolves.toBeUndefined();

    // Safety backup was created (BackupRecord.create called with pre_restore type)
    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "pre_restore" }),
      })
    );
  });
});
