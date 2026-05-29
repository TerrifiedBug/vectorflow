export const runtime = "nodejs";

import { auth } from "@/auth";
import { isOrgWideAdmin } from "@/lib/org-admin";
import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/org-settings";
import { parseS3StorageLocation } from "@/server/services/storage-backend";
import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";

const BACKUP_DIR = process.env.VF_BACKUP_DIR ?? "/backups";

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);
  if (!/^[\w.\-]+$/.test(base)) {
    throw new Error("Invalid filename");
  }
  return base;
}

// Always return JSON for errors so the client can render the message in a toast
// instead of the browser saving the error body as `download.txt`.
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const { filename } = await params;
  let safe: string;
  try {
    safe = sanitizeFilename(filename);
  } catch {
    return jsonError("Invalid filename", 400);
  }

  if (!safe.endsWith(".dump")) {
    return jsonError("Invalid backup filename", 400);
  }

  // Look up the BackupRecord (any non-failed status) so we can authorize the
  // caller against the OWNING organisation. Previously this route authorized
  // against DEFAULT_ORG_ID and looked the record up by filename alone, so an
  // admin of one tenant could download (and orphan) another tenant's backup
  // and read it through the wrong org's S3 credentials.
  const record = await prisma.backupRecord.findFirst({
    where: { filename: safe, status: { in: ["success", "pre_restore", "orphaned"] } },
    select: { id: true, organizationId: true, storageLocation: true, status: true },
  });
  if (!record) {
    return jsonError("Backup not found", 404);
  }

  // Authorize against the backup's own organisation — not a fixed default org.
  const isOrgAdmin = await isOrgWideAdmin(session.user.id, record.organizationId);
  if (!isOrgAdmin) {
    return jsonError("Forbidden", 403);
  }

  if (record.status === "orphaned") {
    return jsonError(
      "This backup's file has been removed from storage. The record is marked as orphaned.",
      410
    );
  }

  if (record.storageLocation?.startsWith("s3://")) {
    // Serve from S3 using direct streaming (no temp file)
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const settings = await getOrgSettings(record.organizationId);

    if (!settings.s3Bucket || !settings.s3AccessKeyId || !settings.s3SecretAccessKey) {
      return jsonError("S3 not configured", 500);
    }

    const { decrypt } = await import("@/server/services/crypto");

    const client = new S3Client({
      region: settings.s3Region ?? "us-east-1",
      credentials: {
        accessKeyId: settings.s3AccessKeyId,
        secretAccessKey: decrypt(settings.s3SecretAccessKey),
      },
      ...(settings.s3Endpoint ? { endpoint: settings.s3Endpoint } : {}),
      forcePathStyle: !!settings.s3Endpoint,
    });

    const { bucket: recordBucket, key } = parseS3StorageLocation(record.storageLocation);

    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: recordBucket,
        Key: key,
      }));

      if (!response.Body) {
        return jsonError("S3 object body is empty", 500);
      }

      const webStream = response.Body.transformToWebStream();

      return new Response(webStream, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safe}"`,
          ...(response.ContentLength ? { "Content-Length": response.ContentLength.toString() } : {}),
        },
      });
    } catch (err: unknown) {
      // Only mark orphaned for definitive not-found errors (NoSuchKey / 404).
      // Transient errors (network, auth, throttling) should surface as 5xx
      // without mutating the record.
      const isNotFound =
        err instanceof Error &&
        ("name" in err && (err.name === "NoSuchKey" || err.name === "NotFound")) ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

      if (isNotFound) {
        await prisma.backupRecord.update({
          where: { id: record.id },
          data: { status: "orphaned" },
        });
        return jsonError(
          "This backup's file has been removed from storage. The record is marked as orphaned.",
          410
        );
      }

      return jsonError("Failed to retrieve backup from S3", 502);
    }
  }

  // Local file
  const filePath = path.join(BACKUP_DIR, safe);

  try {
    await fs.access(filePath);
  } catch (err: unknown) {
    // Only orphan on definitive not-found (ENOENT). Transient FS errors
    // (EACCES, EIO) should not mutate the record.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      await prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: "orphaned" },
      });
      return jsonError(
        "This backup's file has been removed from storage. The record is marked as orphaned.",
        410
      );
    }
    return jsonError("Failed to access backup file", 502);
  }

  const stat = await fs.stat(filePath);
  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Content-Length": stat.size.toString(),
    },
  });
}
