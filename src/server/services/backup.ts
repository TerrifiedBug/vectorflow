import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";

import { prisma } from "@/lib/prisma";
import { debugLog } from "@/lib/logger";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_DIR = process.env.VF_BACKUP_DIR ?? "/backups";
const VF_VERSION = process.env.VF_VERSION ?? "dev";
const PG_DUMP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PG_RESTORE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");
const BACKUP_DISK_WARN_THRESHOLD_MB = Number(
  process.env.VF_BACKUP_DISK_WARN_MB ?? "500"
);

// In-memory lock to prevent concurrent backups
let backupInProgress = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupMetadata {
  version: string;
  timestamp: string;
  migrationCount: number;
  lastMigration: string;
  sizeBytes: number;
  pgVersion: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse DATABASE_URL into components for pg_dump/pg_restore CLI args.
 * Format: postgresql://user:password@host:port/database
 */
function parseDatabaseUrl(): {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
} {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  const url = new URL(raw);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, ""),
  };
}

/**
 * Build common connection args array for pg_dump / pg_restore.
 */
function pgConnectionArgs(db: ReturnType<typeof parseDatabaseUrl>): string[] {
  return ["-h", db.host, "-p", db.port, "-U", db.user, "-d", db.database];
}

/**
 * Count migration directories (excluding migration_lock.toml and dotfiles).
 */
async function getMigrationInfo(): Promise<{
  count: number;
  lastMigration: string;
}> {
  try {
    const entries = await fs.readdir(MIGRATIONS_DIR);
    const migrations = entries
      .filter((e) => !e.startsWith(".") && e !== "migration_lock.toml")
      .sort();
    return {
      count: migrations.length,
      lastMigration: migrations[migrations.length - 1] ?? "",
    };
  } catch {
    return { count: 0, lastMigration: "" };
  }
}

/**
 * Get the PostgreSQL server version.
 */
async function getPgVersion(): Promise<string> {
  const db = parseDatabaseUrl();
  try {
    const { stdout } = await execFileAsync(
      "psql",
      ["-t", "-A", "-c", "SHOW server_version;", ...pgConnectionArgs(db)],
      { env: { ...process.env, PGPASSWORD: db.password }, timeout: 10_000 },
    );
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

/**
 * Sanitize a filename to prevent path-traversal attacks.
 * Strips directory separators and ".." sequences, allowing only safe characters.
 */
function sanitizeFilename(filename: string): string {
  // Take only the basename — strip any directory components
  const base = path.basename(filename);
  // Only allow alphanumeric, dash, underscore, dot
  if (!/^[\w.\-]+$/.test(base)) {
    throw new Error("Invalid filename");
  }
  return base;
}

/**
 * Ensure the backup directory exists.
 */
async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/**
 * Check available disk space in the backup directory.
 * Uses fs.statfs (Node 20+) to read filesystem stats.
 * Returns available MB and whether it is below the configured threshold.
 */
export async function checkDiskSpace(dir: string): Promise<{
  availableMb: number;
  belowThreshold: boolean;
}> {
  const stats = await fs.statfs(dir);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  const availableMb = availableBytes / (1024 * 1024);
  return {
    availableMb: Math.round(availableMb * 100) / 100,
    belowThreshold: availableMb < BACKUP_DISK_WARN_THRESHOLD_MB,
  };
}

/**
 * Compute a SHA256 checksum of a file using streaming reads.
 * Returns the hex-encoded hash string.
 */
export async function computeChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// createBackup
// ---------------------------------------------------------------------------

/**
 * Spawn pg_dump to create a compressed custom-format backup.
 * Writes the dump file and a companion metadata JSON file.
 * Creates a BackupRecord in the database on both success and failure.
 * Checks disk space before starting and logs a warning if below threshold.
 * Updates SystemSettings with backup status.
 */
export async function createBackup(
  type: "scheduled" | "manual" | "pre_restore" = "manual"
): Promise<BackupMetadata> {
  if (backupInProgress) {
    throw new Error("A backup is already in progress");
  }

  backupInProgress = true;
  const startMs = Date.now();

  // Generate filename/path upfront so the record can be created with them
  const timestamp = new Date().toISOString();
  const safeName = `vectorflow-${timestamp.replace(/[:.]/g, "-")}`;
  const dumpFilename = `${safeName}.dump`;
  const dumpPath = path.join(BACKUP_DIR, dumpFilename);
  const metaPath = path.join(BACKUP_DIR, `${safeName}.meta.json`);

  // Create in_progress BackupRecord immediately (filename and storageLocation populated upfront)
  const record = await prisma.backupRecord.create({
    data: {
      filename: dumpFilename,
      status: "in_progress",
      type,
      storageLocation: dumpPath,
      vfVersion: VF_VERSION,
    },
  });

  try {
    await ensureBackupDir();

    // Check disk space (warn but do NOT abort -- RELY-02)
    try {
      const diskCheck = await checkDiskSpace(BACKUP_DIR);
      if (diskCheck.belowThreshold) {
        debugLog("backup", "Low disk space warning", {
          availableMb: diskCheck.availableMb,
          threshold: BACKUP_DISK_WARN_THRESHOLD_MB,
        });
      }
    } catch (diskErr) {
      debugLog("backup", "Could not check disk space", { error: diskErr });
    }

    const db = parseDatabaseUrl();

    // Run pg_dump
    await execFileAsync(
      "pg_dump",
      ["--format=custom", "--compress=6", ...pgConnectionArgs(db), "-f", dumpPath],
      {
        env: { ...process.env, PGPASSWORD: db.password },
        timeout: PG_DUMP_TIMEOUT_MS,
      },
    );

    // Gather metadata (stat, migration info, pg version, checksum -- all in parallel)
    const [stat, migrationInfo, pgVersion, checksum] = await Promise.all([
      fs.stat(dumpPath),
      getMigrationInfo(),
      getPgVersion(),
      computeChecksum(dumpPath),
    ]);

    const metadata: BackupMetadata = {
      version: VF_VERSION,
      timestamp,
      migrationCount: migrationInfo.count,
      lastMigration: migrationInfo.lastMigration,
      sizeBytes: stat.size,
      pgVersion,
    };

    // Write companion .meta.json (preserved for backward compat until Phase 13)
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

    // Update BackupRecord to success
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: {
        status: "success",
        sizeBytes: BigInt(stat.size),
        durationMs: Date.now() - startMs,
        checksum,
        migrationCount: migrationInfo.count,
        lastMigration: migrationInfo.lastMigration,
        pgVersion,
        completedAt: new Date(),
      },
    });

    // Update SystemSettings (existing behavior preserved)
    await prisma.systemSettings.update({
      where: { id: "singleton" },
      data: {
        lastBackupAt: new Date(timestamp),
        lastBackupStatus: "success",
        lastBackupError: null,
      },
    });

    return metadata;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown backup error";

    // Update BackupRecord to failed
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: {
        status: "failed",
        error: message,
        durationMs: Date.now() - startMs,
        completedAt: new Date(),
      },
    }).catch(() => {}); // best-effort -- don't mask original error

    // Update SystemSettings (existing behavior preserved)
    try {
      await prisma.systemSettings.update({
        where: { id: "singleton" },
        data: {
          lastBackupAt: new Date(),
          lastBackupStatus: "failed",
          lastBackupError: message,
        },
      });
    } catch {
      // best-effort
    }

    throw err;
  } finally {
    backupInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// listBackups
// ---------------------------------------------------------------------------

/**
 * Read all .meta.json files from the backup directory and return them
 * sorted newest-first by timestamp.
 */
export async function listBackups(): Promise<
  (BackupMetadata & { filename: string })[]
> {
  await ensureBackupDir();

  const entries = await fs.readdir(BACKUP_DIR);
  const metaFiles = entries.filter((e) => e.endsWith(".meta.json"));

  const results: (BackupMetadata & { filename: string })[] = [];

  for (const metaFile of metaFiles) {
    try {
      const dumpFilename = metaFile.replace(/\.meta\.json$/, ".dump");
      const dumpPath = path.join(BACKUP_DIR, dumpFilename);

      // Skip orphaned .meta.json files where the .dump is missing
      await fs.access(dumpPath);

      const raw = await fs.readFile(path.join(BACKUP_DIR, metaFile), "utf-8");
      const meta = JSON.parse(raw) as BackupMetadata;
      results.push({ ...meta, filename: dumpFilename });
    } catch {
      // skip: either .dump missing or unparseable metadata
    }
  }

  // Sort newest-first
  results.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return results;
}

// ---------------------------------------------------------------------------
// deleteBackup
// ---------------------------------------------------------------------------

/**
 * Delete a backup's .dump and .meta.json files.
 * Sanitizes the filename to prevent path-traversal.
 */
export async function deleteBackup(filename: string): Promise<void> {
  const safe = sanitizeFilename(filename);

  // Ensure the filename ends with .dump
  if (!safe.endsWith(".dump")) {
    throw new Error("Invalid backup filename: must end with .dump");
  }

  const dumpPath = path.join(BACKUP_DIR, safe);
  const metaPath = path.join(
    BACKUP_DIR,
    safe.replace(/\.dump$/, ".meta.json"),
  );

  await Promise.all([
    fs.unlink(dumpPath).catch(() => {}),
    fs.unlink(metaPath).catch(() => {}),
  ]);
}

// ---------------------------------------------------------------------------
// restoreFromBackup
// ---------------------------------------------------------------------------

/**
 * Restore a database from a backup file.
 *
 * 1. Validates version compatibility (blocks if backup has more migrations than current).
 * 2. Verifies checksum against BackupRecord if one exists (skips for legacy backups).
 * 3. Creates a safety backup first.
 * 4. Runs pg_restore --clean --if-exists.
 * 5. Exits the process so Docker restarts the container.
 */
export async function restoreFromBackup(filename: string): Promise<void> {
  const safe = sanitizeFilename(filename);

  if (!safe.endsWith(".dump")) {
    throw new Error("Invalid backup filename: must end with .dump");
  }

  const dumpPath = path.join(BACKUP_DIR, safe);
  const metaPath = path.join(
    BACKUP_DIR,
    safe.replace(/\.dump$/, ".meta.json"),
  );

  // Verify the dump file exists
  await fs.access(dumpPath);

  // Read and validate metadata
  let backupMeta: BackupMetadata | null = null;
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    backupMeta = JSON.parse(raw) as BackupMetadata;
  } catch {
    throw new Error("Backup metadata file not found or unreadable");
  }

  // Version compatibility check: block if backup has more migrations than current
  const currentMigrations = await getMigrationInfo();
  if (backupMeta.migrationCount > currentMigrations.count) {
    throw new Error(
      `Backup has ${backupMeta.migrationCount} migrations but current version only has ${currentMigrations.count}. ` +
        `Upgrade VectorFlow before restoring this backup.`,
    );
  }

  // Verify checksum against BackupRecord if one exists (RELY-03)
  const backupRecord = await prisma.backupRecord.findFirst({
    where: { filename: safe, status: "success" },
    select: { checksum: true },
  });

  if (backupRecord?.checksum) {
    const currentChecksum = await computeChecksum(dumpPath);
    if (currentChecksum !== backupRecord.checksum) {
      throw new Error(
        "Backup file checksum mismatch -- file may be corrupt. " +
        `Expected: ${backupRecord.checksum.slice(0, 16)}..., Got: ${currentChecksum.slice(0, 16)}...`
      );
    }
  }
  // If no BackupRecord exists (legacy backup created before Phase 12), skip checksum verification

  // Create a safety backup before restoring
  await createBackup("pre_restore");

  // Run pg_restore
  const db = parseDatabaseUrl();
  await execFileAsync(
    "pg_restore",
    ["--clean", "--if-exists", ...pgConnectionArgs(db), dumpPath],
    {
      env: { ...process.env, PGPASSWORD: db.password },
      timeout: PG_RESTORE_TIMEOUT_MS,
    },
  );

  // Exit the process so Docker restarts the container
  console.log("[backup] Restore complete — exiting for container restart.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// runRetentionCleanup
// ---------------------------------------------------------------------------

/**
 * Delete the oldest backups beyond the configured retention count.
 */
export async function runRetentionCleanup(): Promise<number> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { backupRetentionCount: true },
  });

  const retentionCount = settings?.backupRetentionCount ?? 7;
  const backups = await listBackups(); // already sorted newest-first

  if (backups.length <= retentionCount) {
    return 0;
  }

  const toDelete = backups.slice(retentionCount);
  let deletedCount = 0;

  for (const backup of toDelete) {
    try {
      await deleteBackup(backup.filename);
      deletedCount++;
    } catch {
      // best-effort deletion
    }
  }

  return deletedCount;
}
