import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
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

// Mock fs (for createReadStream used by computeChecksum, createWriteStream for importBackup)
vi.mock("fs", () => ({
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}));

// Mock stream/promises (pipeline used by importBackup)
vi.mock("stream/promises", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock Readable.fromWeb used by importBackup (preserve rest of stream module)
vi.mock("stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stream")>();
  return {
    ...actual,
    Readable: class extends actual.Readable {
      static fromWeb = vi.fn().mockReturnValue(new actual.Readable({ read() {} }));
    },
  };
});

// Mock logger
vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
}));

// Mock crypto service
vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  decrypt: vi.fn((ciphertext: string) => {
    if (ciphertext === "encrypted:vectorflow-canary-ok") {
      return "vectorflow-canary-ok";
    }
    throw new Error("decrypt failed");
  }),
}));

// Mock storage-backend
vi.mock("@/server/services/storage-backend", () => ({
  getActiveBackend: vi.fn(),
  buildS3Key: vi.fn((prefix: string, filename: string) =>
    prefix ? `${prefix}/${filename}` : filename
  ),
  buildS3StorageLocation: vi.fn((bucket: string, key: string) =>
    `s3://${bucket}/${key}`
  ),
  parseS3StorageLocation: vi.fn((loc: string) => {
    const without = loc.slice("s3://".length);
    const idx = without.indexOf("/");
    return { bucket: without.slice(0, idx), key: without.slice(idx + 1) };
  }),
}));

// ─── Import mocked modules + SUT ─────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import * as childProcess from "child_process";
import * as fsPromises from "fs/promises";
import * as fsSync from "fs";
import { checkDiskSpace, computeChecksum, createBackup } from "../backup";
import * as backupModule from "../backup";
import { getActiveBackend } from "@/server/services/storage-backend";
import { encrypt, decrypt } from "@/server/services/crypto";

const mockGetActiveBackend = vi.mocked(getActiveBackend);
const mockEncrypt = vi.mocked(encrypt);
const mockDecrypt = vi.mocked(decrypt);

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// Typed references to the mocked functions
// execFile has complex overloads; use generic Mock to avoid ChildProcess return mismatch
const mockExecFile = childProcess.execFile as unknown as Mock;
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

  it("seeds encryption canary before pg_dump when missing", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce({
      encryptionCanary: null,
    } as never);

    await createBackup();

    expect(mockEncrypt).toHaveBeenCalledWith("vectorflow-canary-ok");
    expect(prismaMock.systemSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "singleton" },
        data: { encryptionCanary: "encrypted:vectorflow-canary-ok" },
      })
    );
  });

  it("preserves an unreadable encryption canary instead of overwriting it", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce({
      encryptionCanary: "unreadable-canary",
    } as never);

    await createBackup();

    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(prismaMock.systemSettings.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { encryptionCanary: expect.any(String) },
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
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      encryptionCanary: "encrypted:vectorflow-canary-ok",
      backupStorageBackend: "local",
      s3Bucket: null,
      s3Prefix: null,
    } as never);

    // Spy on createBackup (note: vi.spyOn cannot intercept internal module calls,
    // so this is only used in the mismatch test to verify it's NOT called before throw)
    createBackupSpy = vi.spyOn(backupModule, "createBackup");

    // computeChecksum: return fresh stream each time
    mockCreateReadStream.mockImplementation(() =>
      makeReadableStream(Buffer.from("hello world")) as never
    );
  });

  it("verifies checksum before pg_restore", async () => {
    // BackupRecord exists with matching checksum (matches "hello world" SHA256)
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);

    // Should not throw checksum error — proceeds to safety backup + pg_restore
    const result = await backupModule.restoreFromBackup(testFilename);
    expect(result).toEqual({ success: true, warnings: [] });

    // Safety backup was created (BackupRecord.create called with pre_restore type)
    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "pre_restore" }),
      })
    );
  });

  it("returns encryption mismatch warning when restored canary cannot decrypt", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never)
      .mockResolvedValueOnce({ encryptionCanary: "external-instance-canary" } as never);
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(3) }] as never);

    const result = await backupModule.restoreFromBackup(testFilename);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining("Encryption key mismatch"),
    ]);
    expect(mockDecrypt).toHaveBeenCalledWith("external-instance-canary");
  });

  it("warns when restored backup has no encryption canary", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never)
      .mockResolvedValueOnce({ encryptionCanary: null } as never);
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(3) }] as never);

    const result = await backupModule.restoreFromBackup(testFilename);

    expect(result.warnings).toEqual([
      expect.stringContaining("could not be verified"),
    ]);
  });

  it("warns instead of failing when the restored schema predates encryptionCanary", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never)
      .mockRejectedValueOnce(new Error("column \"encryptionCanary\" does not exist"));
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(3) }] as never);

    const result = await backupModule.restoreFromBackup(testFilename);

    expect(result.warnings).toEqual([
      expect.stringContaining("predates the encryption canary migration"),
    ]);
  });

  it("warns when the restored database has no SystemSettings row", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never)
      .mockResolvedValueOnce(null);
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(3) }] as never);

    const result = await backupModule.restoreFromBackup(testFilename);

    expect(result.warnings).toEqual([
      expect.stringContaining("does not contain a SystemSettings canary record"),
    ]);
  });

  it("warns instead of throwing when the restored dump has no Team table", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never)
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never);
    prismaMock.$queryRaw.mockRejectedValue(new Error('relation "Team" does not exist'));

    const result = await backupModule.restoreFromBackup(testFilename);

    expect(result.warnings).toEqual([
      expect.stringContaining('could not verify the "Team" table'),
    ]);
  });




  it("passes --single-transaction to pg_restore", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never)
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never);
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(1) }] as never);

    await backupModule.restoreFromBackup(testFilename);

    const restoreCall = mockExecFile.mock.calls.find(([cmd]) => cmd === "pg_restore");
    expect(restoreCall?.[1]).toContain("--single-transaction");
  });

  it("returns trimmed pg_restore stderr output on success", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never)
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never);
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(1) }] as never);
    mockExecFile.mockImplementation(
      (cmd: string, _args: unknown, _opts: unknown, callback: unknown) => {
        const stderr = cmd === "pg_restore" ? "warning: skipped owner\n" : "";
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr }
        );
      }
    );

    const result = await backupModule.restoreFromBackup(testFilename);

    expect(result.pgRestoreOutput).toBe("warning: skipped owner");
  });

  it("includes pg_restore stderr when restore fails", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      checksum: knownHash,
    } as never);
    prismaMock.systemSettings.findUnique
      .mockResolvedValueOnce({ encryptionCanary: "encrypted:vectorflow-canary-ok" } as never)
      .mockResolvedValueOnce({ backupStorageBackend: "local" } as never);
    mockExecFile.mockImplementation(
      (cmd: string, _args: unknown, _opts: unknown, callback: unknown) => {
        if (cmd === "pg_restore") {
          const error = new Error("pg_restore failed") as Error & { stderr?: string };
          error.stderr = "pg_restore: error: could not execute query";
          (callback as (err: Error) => void)(error);
          return;
        }
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr: "" }
        );
      }
    );

    await expect(backupModule.restoreFromBackup(testFilename)).rejects.toThrow(
      "pg_restore: error: could not execute query"
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
    const result = await backupModule.restoreFromBackup(testFilename);
    expect(result).toEqual({ success: true, warnings: [] });

    // Safety backup was created (BackupRecord.create called with pre_restore type)
    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "pre_restore" }),
      })
    );
  });
});

// ─── listBackups (DB-backed) ──────────────────────────────────────────────────

describe("listBackups (DB-backed)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined);
  });

  it("returns BackupRecord rows from database sorted by startedAt desc", async () => {
    const records = [
      {
        id: "rec-2",
        filename: "vectorflow-newer.dump",
        status: "success",
        type: "scheduled",
        storageLocation: "/backups/vectorflow-newer.dump",
        sizeBytes: BigInt(2048),
        durationMs: 1200,
        checksum: "abc",
        migrationCount: 2,
        lastMigration: "20240102_add_table",
        pgVersion: "16.1",
        vfVersion: "1.0.0",
        error: null,
        startedAt: new Date("2025-02-01T00:00:00Z"),
        completedAt: new Date("2025-02-01T00:00:01Z"),
      },
      {
        id: "rec-1",
        filename: "vectorflow-older.dump",
        status: "success",
        type: "manual",
        storageLocation: "/backups/vectorflow-older.dump",
        sizeBytes: BigInt(1024),
        durationMs: 900,
        checksum: "def",
        migrationCount: 1,
        lastMigration: "20240101000000_init",
        pgVersion: "16.1",
        vfVersion: "1.0.0",
        error: null,
        startedAt: new Date("2025-01-01T00:00:00Z"),
        completedAt: new Date("2025-01-01T00:00:01Z"),
      },
    ];

    prismaMock.backupRecord.findMany.mockResolvedValue(records as never);

    const result = await backupModule.listBackups();

    expect(prismaMock.backupRecord.findMany).toHaveBeenCalledWith({
      orderBy: { startedAt: "desc" },
    });
    expect(result).toEqual(records);
    // No filesystem scanning
    expect(fsMock.readdir).not.toHaveBeenCalled();
  });

  it("includes failed backups in results", async () => {
    const failedRecord = {
      id: "rec-failed",
      filename: "vectorflow-failed.dump",
      status: "failed",
      type: "scheduled",
      storageLocation: "/backups/vectorflow-failed.dump",
      sizeBytes: null,
      durationMs: 300,
      checksum: null,
      migrationCount: null,
      lastMigration: null,
      pgVersion: null,
      vfVersion: "1.0.0",
      error: "pg_dump: connection refused",
      startedAt: new Date("2025-03-01T00:00:00Z"),
      completedAt: new Date("2025-03-01T00:00:00Z"),
    };

    prismaMock.backupRecord.findMany.mockResolvedValue([failedRecord] as never);

    const result = await backupModule.listBackups();

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("failed");
  });
});

// ─── deleteBackup (DB row removal) ───────────────────────────────────────────

describe("deleteBackup (DB row removal)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);
    prismaMock.backupRecord.deleteMany.mockResolvedValue({ count: 1 } as never);
  });

  it("deletes both files and BackupRecord row", async () => {
    await backupModule.deleteBackup("vectorflow-test.dump");

    // Files are deleted
    expect(fsMock.unlink).toHaveBeenCalledTimes(2);
    // DB record is removed
    expect(prismaMock.backupRecord.deleteMany).toHaveBeenCalledWith({
      where: { filename: "vectorflow-test.dump" },
    });
  });
});

// ─── importLegacyBackups ─────────────────────────────────────────────────────

describe("importLegacyBackups", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined);
  });

  it("creates BackupRecord for .meta.json files without existing records", async () => {
    fsMock.readdir.mockResolvedValue(["vectorflow-legacy.meta.json"] as never);
    fsMock.access.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        version: "1.0.0",
        timestamp: "2024-06-01T00:00:00.000Z",
        migrationCount: 3,
        lastMigration: "20240601_add_thing",
        sizeBytes: 5000,
        pgVersion: "15.2",
      })
    );
    prismaMock.backupRecord.findFirst.mockResolvedValue(null);
    prismaMock.backupRecord.create.mockResolvedValue({} as never);

    const result = await backupModule.importLegacyBackups();

    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          filename: "vectorflow-legacy.dump",
          status: "success",
          type: "manual",
        }),
      })
    );
    expect(result).toEqual({ imported: 1, skipped: 0 });
  });

  it("skips files that already have BackupRecord rows", async () => {
    fsMock.readdir.mockResolvedValue(["vectorflow-existing.meta.json"] as never);
    fsMock.access.mockResolvedValue(undefined);
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "existing-rec",
    } as never);

    const result = await backupModule.importLegacyBackups();

    expect(prismaMock.backupRecord.create).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, skipped: 1 });
  });

  it("skips .meta.json without matching .dump file", async () => {
    fsMock.readdir.mockResolvedValue(["vectorflow-nodump.meta.json"] as never);
    // .dump file does not exist
    fsMock.access.mockRejectedValue(new Error("ENOENT"));

    const result = await backupModule.importLegacyBackups();

    expect(prismaMock.backupRecord.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});

// ─── createBackup with S3 backend ────────────────────────────────────────────

describe("createBackup with S3 backend", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.statfs.mockResolvedValue({ bavail: BigInt(200000), bsize: BigInt(4096) });
    fsMock.stat.mockResolvedValue({ size: 2048 });
    fsMock.readdir.mockResolvedValue(["20240101000000_init"]);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);

    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr: "" }
        );
      }
    );

    mockCreateReadStream.mockImplementation(() =>
      makeReadableStream(Buffer.from("dump-file-data")) as never
    );

    prismaMock.backupRecord.create.mockResolvedValue({
      id: "rec-s3",
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

    prismaMock.backupRecord.update.mockResolvedValue({} as never);
    prismaMock.systemSettings.update.mockResolvedValue({} as never);
  });

  it("uploads to S3 and updates storageLocation when S3 is configured", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      backupStorageBackend: "s3",
      s3Bucket: "my-bucket",
      s3Prefix: "backups",
    } as never);

    const mockUpload = vi.fn().mockResolvedValue(undefined);
    mockGetActiveBackend.mockResolvedValue({
      upload: mockUpload,
      download: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
    });

    await createBackup();

    expect(mockUpload).toHaveBeenCalled();
    expect(prismaMock.backupRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storageLocation: expect.stringMatching(/^s3:\/\/my-bucket\/backups\//),
        }),
      })
    );
  });

  it("does not upload to S3 when local storage is configured", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      backupStorageBackend: "local",
      s3Bucket: null,
      s3Prefix: null,
    } as never);

    await createBackup();

    expect(mockGetActiveBackend).not.toHaveBeenCalled();
  });
});

// ─── deleteBackup with S3 backend ────────────────────────────────────────────

describe("deleteBackup with S3 backend", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    prismaMock.backupRecord.deleteMany.mockResolvedValue({ count: 1 } as never);
  });

  it("calls backend.delete for S3-stored backups", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      storageLocation: "s3://my-bucket/backups/test.dump",
    } as never);

    const mockDelete = vi.fn().mockResolvedValue(undefined);
    mockGetActiveBackend.mockResolvedValue({
      upload: vi.fn(),
      download: vi.fn(),
      delete: mockDelete,
      exists: vi.fn(),
    });

    await backupModule.deleteBackup("test.dump");

    expect(mockGetActiveBackend).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith("backups/test.dump");
  });
});

// ─── restoreFromBackup with S3 backend ───────────────────────────────────────

describe("restoreFromBackup with S3 backend", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    fsMock.access.mockResolvedValue(undefined);
    fsMock.readFile.mockRejectedValue(new Error("ENOENT"));
    fsMock.readdir.mockResolvedValue(["20240101000000_init"] as never);
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.statfs.mockResolvedValue({ bavail: BigInt(200000), bsize: BigInt(4096) });
    fsMock.stat.mockResolvedValue({ size: 1024 });
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);

    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr: "" }
        );
      }
    );

    mockCreateReadStream.mockImplementation(() =>
      makeReadableStream(Buffer.from("hello world")) as never
    );

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
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      encryptionCanary: "encrypted:vectorflow-canary-ok",
      backupStorageBackend: "local",
      s3Bucket: null,
      s3Prefix: null,
    } as never);
  });

  it("downloads from S3 before pg_restore for S3 backups", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-s3",
      filename: "backup.dump",
      status: "success",
      checksum: null,
      storageLocation: "s3://my-bucket/backups/backup.dump",
      migrationCount: 1,
      lastMigration: "20240101000000_init",
      vfVersion: "1.0.0",
      pgVersion: "16.1",
      sizeBytes: BigInt(1024),
      startedAt: new Date(),
    } as never);

    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockGetActiveBackend.mockResolvedValue({
      upload: vi.fn(),
      download: mockDownload,
      delete: vi.fn(),
      exists: vi.fn(),
    });

    const result = await backupModule.restoreFromBackup("backup.dump");

    expect(mockDownload).toHaveBeenCalled();
    expect(result).toEqual({ success: true, warnings: [] });
  });
});

// ─── runRetentionCleanup (DB-backed) ─────────────────────────────────────────

describe("runRetentionCleanup (DB-backed)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);
  });

  it("deletes oldest backups beyond retention and removes DB records", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      backupRetentionCount: 2,
    } as never);

    const records = [
      { id: "rec-3", filename: "vectorflow-newest.dump", status: "success", startedAt: new Date("2025-03-01") },
      { id: "rec-2", filename: "vectorflow-middle.dump", status: "success", startedAt: new Date("2025-02-01") },
      { id: "rec-1", filename: "vectorflow-oldest.dump", status: "success", startedAt: new Date("2025-01-01") },
    ];

    prismaMock.backupRecord.findMany
      .mockResolvedValueOnce(records as never) // success/pre_restore for retention
      .mockResolvedValueOnce([] as never) // failed records
      .mockResolvedValueOnce([] as never); // stale in_progress
    prismaMock.backupRecord.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.backupRecord.findFirst.mockResolvedValue(null);

    const deletedCount = await backupModule.runRetentionCleanup();

    expect(deletedCount).toBe(1);
    // The oldest record should be deleted from DB
    expect(prismaMock.backupRecord.deleteMany).toHaveBeenCalledWith({
      where: { filename: "vectorflow-oldest.dump" },
    });
    // File should also be unlinked
    expect(fsMock.unlink).toHaveBeenCalled();
  });
});

// ─── previewBackup ────────────────────────────────────────────────────────────

describe("previewBackup", () => {
  const testFilename = "vectorflow-2025-01-01T02-00-00-000Z.dump";

  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    fsMock.access = vi.fn().mockResolvedValue(undefined);
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);

    // Default: pg_restore --list returns table listing
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        const stdout = [
          "2084; 0 0 COMMENT - EXTENSION plpgsql",
          "270; 1259 16384 TABLE public User postgres",
          "1259; 0 32768 TABLE DATA public User postgres",
          "1260; 0 32769 TABLE DATA public Team postgres",
          "1261; 0 32770 TABLE DATA public Pipeline postgres",
        ].join("\n");
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout, stderr: "" }
        );
      }
    );
  });

  it("returns preview with tables from pg_restore --list for local backup", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-1",
      filename: testFilename,
      status: "success",
      storageLocation: "/backups/" + testFilename,
      vfVersion: "1.2.0",
      migrationCount: 5,
      lastMigration: "20250101_add_thing",
      sizeBytes: BigInt(10240),
      pgVersion: "16.1",
      startedAt: new Date("2025-01-01T02:00:00Z"),
    } as never);

    const result = await backupModule.previewBackup(testFilename);

    expect(result.filename).toBe(testFilename);
    expect(result.vfVersion).toBe("1.2.0");
    expect(result.migrationCount).toBe(5);
    expect(result.lastMigration).toBe("20250101_add_thing");
    expect(result.sizeBytes).toBe(10240);
    expect(result.pgVersion).toBe("16.1");
    expect(result.startedAt).toEqual(new Date("2025-01-01T02:00:00Z"));
    expect(result.tablesPresent).toContain("User");
    expect(result.tablesPresent).toContain("Team");
    expect(result.tablesPresent).toContain("Pipeline");
  });

  it("throws when record not found", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue(null);

    await expect(backupModule.previewBackup(testFilename)).rejects.toThrow(
      "Backup record not found or not successful"
    );
  });

  it("throws when record is not status=success", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue(null);

    await expect(backupModule.previewBackup(testFilename)).rejects.toThrow(
      "Backup record not found or not successful"
    );
  });

  it("downloads S3 backup to temp and cleans up in finally block", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-s3",
      filename: testFilename,
      status: "success",
      storageLocation: "s3://my-bucket/backups/" + testFilename,
      vfVersion: "1.2.0",
      migrationCount: 3,
      lastMigration: "20250101_init",
      sizeBytes: BigInt(8192),
      pgVersion: "16.1",
      startedAt: new Date("2025-01-01T02:00:00Z"),
    } as never);

    fsMock.mkdir = vi.fn().mockResolvedValue(undefined);

    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockGetActiveBackend.mockResolvedValue({
      upload: vi.fn(),
      download: mockDownload,
      delete: vi.fn(),
      exists: vi.fn(),
    });

    await backupModule.previewBackup(testFilename);

    expect(mockDownload).toHaveBeenCalled();
    // temp file should be cleaned up
    expect(fsMock.unlink).toHaveBeenCalled();
  });

  it("deduplicates table names from pg_restore --list output", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-1",
      filename: testFilename,
      status: "success",
      storageLocation: "/backups/" + testFilename,
      vfVersion: "1.0.0",
      migrationCount: 1,
      lastMigration: "20250101_init",
      sizeBytes: BigInt(1024),
      pgVersion: "16.1",
      startedAt: new Date("2025-01-01T02:00:00Z"),
    } as never);

    // pg_restore --list with duplicate TABLE DATA entries
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        const stdout = [
          "1259; 0 32768 TABLE DATA public User postgres",
          "1260; 0 32769 TABLE DATA public User postgres", // duplicate
        ].join("\n");
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout, stderr: "" }
        );
      }
    );

    const result = await backupModule.previewBackup(testFilename);

    // Deduplicated
    expect(result.tablesPresent.filter((t) => t === "User")).toHaveLength(1);
  });

  it("warns that imported backups have unknown encryption compatibility", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-imported",
      filename: testFilename,
      status: "success",
      type: "imported",
      storageLocation: "/backups/" + testFilename,
      vfVersion: "1.2.0",
      migrationCount: 1,
      lastMigration: "20250101_init",
      sizeBytes: BigInt(1024),
      pgVersion: "16.1",
      startedAt: new Date(),
    } as never);
    fsMock.readdir.mockResolvedValue(["20250101_init"] as never);

    const result = await backupModule.previewBackup(testFilename);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "ENCRYPTION_UNKNOWN",
        }),
      ])
    );
  });

  it("returns an error warning when backup has more migrations than current code", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-newer",
      filename: testFilename,
      status: "success",
      type: "manual",
      storageLocation: "/backups/" + testFilename,
      vfVersion: "1.2.0",
      migrationCount: 3,
      lastMigration: "20250103_newer",
      sizeBytes: BigInt(1024),
      pgVersion: "16.1",
      startedAt: new Date(),
    } as never);
    fsMock.readdir.mockResolvedValue(["20250101_init"] as never);

    const result = await backupModule.previewBackup(testFilename);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "MIGRATION_AHEAD",
        }),
      ])
    );
  });

  it("warns when PostgreSQL major versions differ", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-pg",
      filename: testFilename,
      status: "success",
      type: "manual",
      storageLocation: "/backups/" + testFilename,
      vfVersion: "1.2.0",
      migrationCount: 1,
      lastMigration: "20250101_init",
      sizeBytes: BigInt(1024),
      pgVersion: "15.6",
      startedAt: new Date(),
    } as never);
    fsMock.readdir.mockResolvedValue(["20250101_init"] as never);
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], _opts: unknown, callback: unknown) => {
        const stdout = cmd === "psql"
          ? "16.1"
          : "1259; 0 32768 TABLE DATA public Team postgres";
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout, stderr: "" }
        );
      }
    );

    const result = await backupModule.previewBackup(testFilename);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "PG_VERSION_MISMATCH",
        }),
      ])
    );
  });

  it("uses the dump header PostgreSQL version when the record metadata is stale", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-pg-stale",
      filename: testFilename,
      status: "success",
      type: "imported",
      storageLocation: "/backups/" + testFilename,
      vfVersion: "1.2.0",
      migrationCount: 1,
      lastMigration: "20250101_init",
      sizeBytes: BigInt(1024),
      pgVersion: "unknown",
      startedAt: new Date(),
    } as never);
    fsMock.readdir.mockResolvedValue(["20250101_init"] as never);
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], _opts: unknown, callback: unknown) => {
        const stdout = cmd === "psql"
          ? "16.1"
          : [
              ";     Dumped from database version: 15.6",
              "1259; 0 32768 TABLE DATA public Team postgres",
            ].join("\n");
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout, stderr: "" }
        );
      }
    );

    const result = await backupModule.previewBackup(testFilename);

    expect(result.pgVersion).toBe("15.6");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "PG_VERSION_MISMATCH",
        }),
      ])
    );
  });
});

// ─── restoreFromBackup - graceful ────────────────────────────────────────────

describe("restoreFromBackup - graceful", () => {
  const testFilename = "vectorflow-2025-01-01T02-00-00-000Z.dump";

  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    fsMock.access = vi.fn().mockResolvedValue(undefined);
    fsMock.readFile = vi.fn().mockRejectedValue(new Error("ENOENT"));
    fsMock.readdir = vi.fn().mockResolvedValue(["20240101000000_init"]);
    fsMock.mkdir = vi.fn().mockResolvedValue(undefined);
    fsMock.statfs = vi.fn().mockResolvedValue({ bavail: BigInt(200000), bsize: BigInt(4096) });
    fsMock.stat = vi.fn().mockResolvedValue({ size: 1024 });
    fsMock.writeFile = vi.fn().mockResolvedValue(undefined);
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);

    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr: "" }
        );
      }
    );

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
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      encryptionCanary: "encrypted:vectorflow-canary-ok",
      backupStorageBackend: "local",
      s3Bucket: null,
      s3Prefix: null,
    } as never);

    mockCreateReadStream.mockImplementation(() =>
      makeReadableStream(Buffer.from("hello world")) as never
    );
  });

  it("returns { success: true } instead of calling process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-1",
      filename: testFilename,
      status: "success",
      checksum: null,
      migrationCount: 1,
      lastMigration: "20240101000000_init",
      vfVersion: "1.0.0",
      pgVersion: "16.1",
      sizeBytes: BigInt(1024),
      startedAt: new Date("2025-01-01T02:00:00Z"),
      storageLocation: "/backups/" + testFilename,
    } as never);

    const result = await backupModule.restoreFromBackup(testFilename);

    expect(result).toEqual({ success: true, warnings: [] });
    // process.exit should NOT be called
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("throws if restoreInProgress is true (concurrent restore)", async () => {
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-1",
      filename: testFilename,
      status: "success",
      checksum: null,
      migrationCount: 1,
      lastMigration: "20240101000000_init",
      vfVersion: "1.0.0",
      pgVersion: "16.1",
      sizeBytes: BigInt(1024),
      startedAt: new Date("2025-01-01T02:00:00Z"),
      storageLocation: "/backups/" + testFilename,
    } as never);

    // Simulate a restore already in progress by starting one and not letting it finish
    let firstResolve!: () => void;
    const blockPromise = new Promise<void>((resolve) => {
      firstResolve = resolve;
    });

    // Make pg_restore block until we resolve manually
    let callCount = 0;
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        callCount++;
        if (callCount === 1) {
          // pg_dump for safety backup — succeed immediately
          (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: "16.1", stderr: "" }
          );
        } else if (callCount === 2) {
          // psql for getPgVersion in safety backup
          (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: "16.1", stderr: "" }
          );
        } else {
          // pg_restore — block until we're done testing
          blockPromise.then(() => {
            (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
              null,
              { stdout: "", stderr: "" }
            );
          });
        }
      }
    );

    // Start first restore (will block at pg_restore)
    const firstRestore = backupModule.restoreFromBackup(testFilename);

    // Give it a tick to start executing and set restoreInProgress = true
    await new Promise((r) => setTimeout(r, 10));

    // Second restore attempt should throw
    await expect(backupModule.restoreFromBackup(testFilename)).rejects.toThrow(
      "A restore is already in progress"
    );

    // Clean up: unblock the first restore
    firstResolve();
    await firstRestore.catch(() => {});
  });
});

// ─── runOrphanCleanup ─────────────────────────────────────────────────────────

describe("runOrphanCleanup", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    fsMock.readdir = vi.fn().mockResolvedValue([]);
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);
    fsMock.access = vi.fn().mockResolvedValue(undefined);

    prismaMock.backupRecord.findFirst.mockResolvedValue(null);
    prismaMock.backupRecord.findMany.mockResolvedValue([]);
    prismaMock.backupRecord.update.mockResolvedValue({} as never);
  });

  it("deletes .dump files in BACKUP_DIR without matching BackupRecord", async () => {
    fsMock.readdir = vi.fn().mockResolvedValue(["orphan.dump", "orphan2.dump"]);
    prismaMock.backupRecord.findFirst.mockResolvedValue(null); // no record for either

    const result = await backupModule.runOrphanCleanup();

    expect(fsMock.unlink).toHaveBeenCalledTimes(2);
    expect(result.filesDeleted).toBe(2);
  });

  it("ignores non-.dump files in BACKUP_DIR", async () => {
    fsMock.readdir = vi.fn().mockResolvedValue(["orphan.meta.json", "orphan.dump"]);
    prismaMock.backupRecord.findFirst
      .mockResolvedValueOnce(null) // for orphan.dump — no record
      .mockResolvedValueOnce(null);

    const result = await backupModule.runOrphanCleanup();

    // Only orphan.dump should be deleted (not .meta.json)
    expect(result.filesDeleted).toBe(1);
  });

  it("marks records as orphaned when local file is missing", async () => {
    prismaMock.backupRecord.findMany.mockResolvedValue([
      {
        id: "rec-1",
        filename: "vectorflow-missing.dump",
        storageLocation: "/backups/vectorflow-missing.dump",
      },
    ] as never);

    // Local file does NOT exist
    fsMock.access = vi.fn().mockRejectedValue(new Error("ENOENT"));

    const result = await backupModule.runOrphanCleanup();

    expect(prismaMock.backupRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: { status: "orphaned" },
      })
    );
    expect(result.recordsOrphaned).toBe(1);
  });

  it("uses backend.exists for S3 records and marks as orphaned when S3 object missing", async () => {
    prismaMock.backupRecord.findMany.mockResolvedValue([
      {
        id: "rec-s3",
        filename: "vectorflow-s3-missing.dump",
        storageLocation: "s3://my-bucket/backups/vectorflow-s3-missing.dump",
      },
    ] as never);

    const mockExists = vi.fn().mockResolvedValue(false); // S3 object missing
    mockGetActiveBackend.mockResolvedValue({
      upload: vi.fn(),
      download: vi.fn(),
      delete: vi.fn(),
      exists: mockExists,
    });

    const result = await backupModule.runOrphanCleanup();

    expect(mockExists).toHaveBeenCalledWith("backups/vectorflow-s3-missing.dump");
    expect(prismaMock.backupRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-s3" },
        data: { status: "orphaned" },
      })
    );
    expect(result.recordsOrphaned).toBe(1);
  });

  it("returns { filesDeleted: 0, recordsOrphaned: 0 } when nothing to clean", async () => {
    fsMock.readdir = vi.fn().mockResolvedValue(["existing.dump"]);
    prismaMock.backupRecord.findFirst.mockResolvedValue({ id: "rec-1" } as never);
    prismaMock.backupRecord.findMany.mockResolvedValue([
      {
        id: "rec-1",
        filename: "existing.dump",
        storageLocation: "/backups/existing.dump",
      },
    ] as never);
    fsMock.access = vi.fn().mockResolvedValue(undefined); // file exists

    const result = await backupModule.runOrphanCleanup();

    expect(result).toEqual({ filesDeleted: 0, recordsOrphaned: 0 });
  });
});

// ─── restoreFromBackup - BackupRecord fallback ────────────────────────────────

describe("restoreFromBackup - BackupRecord fallback", () => {
  const testFilename = "vectorflow-2025-06-01T00-00-00-000Z.dump";

  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    // Dump file exists
    fsMock.access.mockResolvedValue(undefined);

    // .meta.json is MISSING (throws)
    fsMock.readFile.mockRejectedValue(new Error("ENOENT: no such file"));

    // Migration dir: one migration (matching the BackupRecord)
    fsMock.readdir.mockResolvedValue(["20240101000000_init"] as never);

    // Set up mocks for the safety createBackup("pre_restore") call
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.statfs.mockResolvedValue({ bavail: BigInt(200000), bsize: BigInt(4096) });
    fsMock.stat.mockResolvedValue({ size: 1024 });
    fsMock.writeFile.mockResolvedValue(undefined);

    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "16.1", stderr: "" }
        );
      }
    );

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
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      encryptionCanary: "encrypted:vectorflow-canary-ok",
      backupStorageBackend: "local",
      s3Bucket: null,
      s3Prefix: null,
    } as never);

    mockCreateReadStream.mockImplementation(() =>
      makeReadableStream(Buffer.from("hello world")) as never
    );
  });

  it("falls back to BackupRecord when .meta.json is missing", async () => {
    // BackupRecord has the metadata needed for restore
    prismaMock.backupRecord.findFirst.mockResolvedValue({
      id: "rec-existing",
      filename: testFilename,
      status: "success",
      checksum: null,
      migrationCount: 1,
      lastMigration: "20240101000000_init",
      vfVersion: "1.0.0",
      pgVersion: "16.1",
      sizeBytes: BigInt(1024),
      startedAt: new Date("2025-06-01T00:00:00Z"),
    } as never);

    // Should NOT throw "Backup metadata file not found" — should fall back to BackupRecord
    const result = await backupModule.restoreFromBackup(testFilename);
    expect(result).toEqual({ success: true, warnings: [] });
  });
});

// ─── runRetentionCleanup - fixed (only counts success/pre_restore) ────────────

describe("runRetentionCleanup - scoped retention", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);
  });

  it("ignores failed/orphaned records when counting toward retention", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      backupRetentionCount: 3,
    } as never);

    // 2 success records + 5 failed records — only the 2 success should matter
    const successRecords = [
      { id: "s1", filename: "backup-1.dump", status: "success", startedAt: new Date("2025-03-01") },
      { id: "s2", filename: "backup-2.dump", status: "success", startedAt: new Date("2025-02-01") },
    ];

    const failedRecords = [
      { id: "f1", filename: "failed-1.dump", status: "failed", startedAt: new Date("2025-03-02") },
      { id: "f2", filename: "failed-2.dump", status: "failed", startedAt: new Date("2025-02-15") },
      { id: "f3", filename: "failed-3.dump", status: "failed", startedAt: new Date("2025-02-10") },
      { id: "f4", filename: "failed-4.dump", status: "failed", startedAt: new Date("2025-01-15") },
    ];

    // findMany call 1: success/pre_restore records for retention
    prismaMock.backupRecord.findMany
      .mockResolvedValueOnce(successRecords as never)
      // findMany call 2: failed records for cleanup
      .mockResolvedValueOnce(failedRecords as never)
      // findMany call 3: stale in_progress
      .mockResolvedValueOnce([] as never);

    prismaMock.backupRecord.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.backupRecord.findFirst.mockResolvedValue(null);

    const deletedCount = await backupModule.runRetentionCleanup();

    // Retention=3, only 2 success records: no success records should be deleted
    // But 4 failed records > 3 kept: 1 stale failure should be deleted
    expect(deletedCount).toBe(1);
  });

  it("cleans up stale in_progress records older than 1 hour", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      backupRetentionCount: 7,
    } as never);

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const staleRecords = [
      { id: "ip1", filename: "in-progress-old.dump", status: "in_progress", startedAt: twoHoursAgo },
    ];

    prismaMock.backupRecord.findMany
      .mockResolvedValueOnce([] as never) // success/pre_restore
      .mockResolvedValueOnce([] as never) // failed
      .mockResolvedValueOnce(staleRecords as never); // stale in_progress

    prismaMock.backupRecord.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.backupRecord.findFirst.mockResolvedValue(null);

    const deletedCount = await backupModule.runRetentionCleanup();

    expect(deletedCount).toBe(1);
  });
});

// ─── runOrphanCleanup - S3 bucket mismatch guard ─────────────────────────────

describe("runOrphanCleanup - S3 bucket mismatch", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    fsMock.readdir = vi.fn().mockResolvedValue([]);
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);
    fsMock.access = vi.fn().mockResolvedValue(undefined);

    prismaMock.backupRecord.findFirst.mockResolvedValue(null);
    prismaMock.backupRecord.findMany.mockResolvedValue([]);
    prismaMock.backupRecord.update.mockResolvedValue({} as never);
  });

  it("skips orphaning records whose S3 bucket differs from current config", async () => {
    prismaMock.backupRecord.findMany.mockResolvedValue([
      {
        id: "rec-old-bucket",
        filename: "vectorflow-old-bucket.dump",
        storageLocation: "s3://old-bucket/backups/vectorflow-old-bucket.dump",
      },
    ] as never);

    // Current settings point to a different bucket
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      s3Bucket: "new-bucket",
    } as never);

    const mockExists = vi.fn().mockResolvedValue(false);
    mockGetActiveBackend.mockResolvedValue({
      upload: vi.fn(),
      download: vi.fn(),
      delete: vi.fn(),
      exists: mockExists,
    });

    const result = await backupModule.runOrphanCleanup();

    // Should NOT have called exists — skipped due to bucket mismatch
    expect(mockExists).not.toHaveBeenCalled();
    // Should NOT have marked as orphaned
    expect(prismaMock.backupRecord.update).not.toHaveBeenCalled();
    expect(result.recordsOrphaned).toBe(0);
  });
});

// ─── importBackup ────────────────────────────────────────────────────────────

describe("importBackup", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();

    fsMock.mkdir = vi.fn().mockResolvedValue(undefined);
    fsMock.writeFile = vi.fn().mockResolvedValue(undefined);
    fsMock.stat = vi.fn().mockResolvedValue({ size: 2048 });
    fsMock.unlink = vi.fn().mockResolvedValue(undefined);
  });

  it("creates a BackupRecord with type=imported on valid file", async () => {
    // pg_restore --list succeeds (valid dump)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb?: CallableFunction) => {
      if (cb) cb(null, { stdout: "table list output", stderr: "" });
      return {};
    });

    // computeChecksum mock
    mockCreateReadStream.mockReturnValue(makeReadableStream("test-data") as never);

    prismaMock.backupRecord.create.mockResolvedValue({ id: "rec-imported" } as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      backupStorageBackend: "local",
    } as never);

    // Create a mock ReadableStream (pipeline is mocked, so it won't be consumed)
    const mockStream = new ReadableStream({ start(c) { c.close(); } });
    const result = await backupModule.importBackup(mockStream, "external-backup.dump");

    expect(result.version).toBeDefined();
    expect(result.sizeBytes).toBe(2048);

    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "imported",
          status: "success",
        }),
      })
    );
  });

  it("stores source postgres version and actual migration rows from imported dump metadata", async () => {
    const listOutput = [
      "; Archive created at 2026-05-12 20:00:00 UTC",
      ";     dbname: vectorflow",
      ";     TOC Entries: 4",
      ";     Compression: -1",
      ";     Dump Version: 1.16-0",
      ";     Format: CUSTOM",
      ";     Integer: 4 bytes",
      ";     Offset: 8 bytes",
      ";     Dumped from database version: 16.4",
      ";     Dumped by pg_dump version: 17.1",
      "1259; 0 32768 TABLE DATA public _prisma_migrations postgres",
      "1260; 0 32769 TABLE DATA public Team postgres",
    ].join("\n");
    const migrationDataOutput = [
      'COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;',
      'id-1\tchecksum-1\t2026-05-11 00:00:00\t20250101000000_init\t\\N\t\\N\t2026-05-11 00:00:00\t1',
      'id-2\tchecksum-2\t2026-05-12 00:00:00\t20250102000000_add_alerts\t\\N\t\\N\t2026-05-12 00:00:00\t1',
      'id-rolled\tchecksum-r\t2026-05-12 00:00:00\t20250101595959_rolled_back\t\\N\t2026-05-12 01:00:00\t2026-05-12 00:30:00\t1',
      '\\.',
    ].join("\n");
    mockExecFile.mockImplementation((cmd: string, args: string[], _opts: unknown, cb?: CallableFunction) => {
      if (cmd === "pg_restore" && args.includes("--list")) {
        cb?.(null, { stdout: listOutput, stderr: "" });
        return {};
      }
      if (cmd === "pg_restore" && args.includes("--table=_prisma_migrations")) {
        cb?.(null, { stdout: migrationDataOutput, stderr: "" });
        return {};
      }
      cb?.(null, { stdout: "", stderr: "" });
      return {};
    });
    mockCreateReadStream.mockReturnValue(makeReadableStream("test-data") as never);
    prismaMock.backupRecord.create.mockResolvedValue({ id: "rec-imported" } as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      backupStorageBackend: "local",
    } as never);

    const mockStream = new ReadableStream({ start(c) { c.close(); } });
    const result = await backupModule.importBackup(mockStream, "external-backup.dump");

    expect(result.migrationCount).toBe(2);
    expect(result.lastMigration).toBe("20250102000000_add_alerts");
    expect(result.pgVersion).toBe("16.4");
    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          migrationCount: 2,
          lastMigration: "20250102000000_add_alerts",
          pgVersion: "16.4",
        }),
      })
    );
  });


  it("throws and cleans up for invalid dump file", async () => {
    // pg_restore --list fails (invalid dump)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb?: CallableFunction) => {
      if (cb) cb(new Error("pg_restore: error: invalid format"), { stdout: "", stderr: "" });
      return {};
    });

    const mockStream = new ReadableStream({ start(c) { c.close(); } });
    await expect(
      backupModule.importBackup(mockStream, "bad-file.dump")
    ).rejects.toThrow("Invalid backup file");

    // Should have cleaned up the written file
    expect(fsMock.unlink).toHaveBeenCalled();
    // Should NOT have created a record
    expect(prismaMock.backupRecord.create).not.toHaveBeenCalled();
  });
});
