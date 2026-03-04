import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_DIR = process.env.VF_BACKUP_DIR ?? "/backups";
const VF_VERSION = process.env.VF_VERSION ?? "dev";
const PG_DUMP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PG_RESTORE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

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

// ---------------------------------------------------------------------------
// createBackup
// ---------------------------------------------------------------------------

/**
 * Spawn pg_dump to create a compressed custom-format backup.
 * Writes the dump file and a companion metadata JSON file.
 * Updates SystemSettings with backup status.
 */
export async function createBackup(): Promise<BackupMetadata> {
  if (backupInProgress) {
    throw new Error("A backup is already in progress");
  }

  backupInProgress = true;

  try {
    await ensureBackupDir();

    const db = parseDatabaseUrl();
    const timestamp = new Date().toISOString();
    const safeName = `vectorflow-${timestamp.replace(/[:.]/g, "-")}`;
    const dumpPath = path.join(BACKUP_DIR, `${safeName}.dump`);
    const metaPath = path.join(BACKUP_DIR, `${safeName}.meta.json`);

    // Run pg_dump
    await execFileAsync(
      "pg_dump",
      ["--format=custom", "--compress=6", ...pgConnectionArgs(db), "-f", dumpPath],
      {
        env: { ...process.env, PGPASSWORD: db.password },
        timeout: PG_DUMP_TIMEOUT_MS,
      },
    );

    // Gather metadata
    const [stat, migrationInfo, pgVersion] = await Promise.all([
      fs.stat(dumpPath),
      getMigrationInfo(),
      getPgVersion(),
    ]);

    const metadata: BackupMetadata = {
      version: VF_VERSION,
      timestamp,
      migrationCount: migrationInfo.count,
      lastMigration: migrationInfo.lastMigration,
      sizeBytes: stat.size,
      pgVersion,
    };

    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

    // Update SystemSettings
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
    // Record failure in SystemSettings
    const message =
      err instanceof Error ? err.message : "Unknown backup error";

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
      // best-effort — don't mask the original error
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
      const raw = await fs.readFile(path.join(BACKUP_DIR, metaFile), "utf-8");
      const meta = JSON.parse(raw) as BackupMetadata;
      // Derive dump filename from meta filename
      const dumpFilename = metaFile.replace(/\.meta\.json$/, ".dump");
      results.push({ ...meta, filename: dumpFilename });
    } catch {
      // skip unparseable metadata files
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
 * 2. Creates a safety backup first.
 * 3. Runs pg_restore --clean --if-exists.
 * 4. Exits the process so Docker restarts the container.
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

  // Create a safety backup before restoring
  await createBackup();

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
