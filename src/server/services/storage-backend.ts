import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

import { decrypt } from "@/server/services/crypto";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_DIR = process.env.VF_BACKUP_DIR ?? "/backups";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Generic storage backend interface for uploading, downloading, deleting, and
 * checking existence of backup files.
 */
export interface StorageBackend {
  upload(localPath: string, key: string): Promise<void>;
  download(key: string, destPath: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface S3Config {
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// LocalBackend
// ---------------------------------------------------------------------------

/**
 * Local filesystem backend. Files are already on disk so upload/download are
 * no-ops. Delete and exists operate on the configured backup directory.
 */
export class LocalBackend implements StorageBackend {
  constructor(private readonly backupDir: string) {}

  /** No-op: file is already at localPath on the local filesystem. */
  async upload(_localPath: string, _key: string): Promise<void> {} // eslint-disable-line @typescript-eslint/no-unused-vars

  /** No-op: caller already has the file path for local backups. */
  async download(_key: string, _destPath: string): Promise<void> {} // eslint-disable-line @typescript-eslint/no-unused-vars

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.backupDir, key)).catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.backupDir, key));
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// S3Backend
// ---------------------------------------------------------------------------

/**
 * S3-compatible storage backend. Supports AWS S3, MinIO, DigitalOcean Spaces,
 * and any other S3-compatible service.
 *
 * When a custom endpoint is provided, forcePathStyle is automatically enabled
 * to support MinIO and other path-style services.
 */
export class S3Backend implements StorageBackend {
  private readonly config: S3Config;
  readonly client: S3Client;

  constructor(config: S3Config) {
    this.config = config;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      // Auto-enable path-style for MinIO and other path-style services
      forcePathStyle: !!config.endpoint,
    });
  }

  /**
   * Upload a local file to S3.
   * ContentLength is set explicitly to prevent SDK retry-hang on streams.
   */
  async upload(localPath: string, key: string): Promise<void> {
    const stat = await fs.stat(localPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: stat.size,
        ContentType: "application/octet-stream",
      })
    );
  }

  /** Download an object from S3 to a local destination path. */
  async download(key: string, destPath: string): Promise<void> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })
    );

    const writeStream = createWriteStream(destPath);
    await pipeline(response.Body as Readable, writeStream);
  }

  /** Delete an object from S3. */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })
    );
  }

  /** Check if an object exists in S3 using HeadObject. */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Build an S3 object key from an optional prefix and filename.
 * Strips trailing slashes from the prefix.
 */
export function buildS3Key(prefix: string, filename: string): string {
  return prefix ? `${prefix.replace(/\/$/, "")}/${filename}` : filename;
}

/**
 * Build an S3 storage location URI from a bucket and key.
 * Format: s3://bucket/key
 */
export function buildS3StorageLocation(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

/**
 * Parse an S3 storage location URI into bucket and key components.
 * Input format: s3://bucket/prefix/file.dump
 */
export function parseS3StorageLocation(location: string): {
  bucket: string;
  key: string;
} {
  const withoutProtocol = location.replace(/^s3:\/\//, "");
  const slashIdx = withoutProtocol.indexOf("/");
  if (slashIdx === -1) {
    return { bucket: withoutProtocol, key: "" };
  }
  return {
    bucket: withoutProtocol.slice(0, slashIdx),
    key: withoutProtocol.slice(slashIdx + 1),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Read SystemSettings and return the active StorageBackend.
 * Returns S3Backend when backupStorageBackend === "s3" and all required
 * credentials are present. Falls back to LocalBackend otherwise.
 */
export async function getActiveBackend(): Promise<StorageBackend> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: {
      backupStorageBackend: true,
      s3Bucket: true,
      s3Region: true,
      s3Prefix: true,
      s3AccessKeyId: true,
      s3SecretAccessKey: true,
      s3Endpoint: true,
    },
  });

  if (
    settings?.backupStorageBackend === "s3" &&
    settings.s3Bucket &&
    settings.s3AccessKeyId &&
    settings.s3SecretAccessKey
  ) {
    return new S3Backend({
      bucket: settings.s3Bucket,
      region: settings.s3Region ?? "us-east-1",
      prefix: settings.s3Prefix ?? "",
      accessKeyId: settings.s3AccessKeyId,
      secretAccessKey: decrypt(settings.s3SecretAccessKey),
      endpoint: settings.s3Endpoint ?? undefined,
    });
  }

  return new LocalBackend(BACKUP_DIR);
}
