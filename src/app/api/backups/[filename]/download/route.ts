import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true },
  });

  if (!user?.isSuperAdmin) {
    return new Response("Forbidden", { status: 403 });
  }

  const { filename } = await params;
  let safe: string;
  try {
    safe = sanitizeFilename(filename);
  } catch {
    return new Response("Invalid filename", { status: 400 });
  }

  if (!safe.endsWith(".dump")) {
    return new Response("Invalid backup filename", { status: 400 });
  }

  // Look up BackupRecord to determine storage location
  const record = await prisma.backupRecord.findFirst({
    where: { filename: safe, status: "success" },
    select: { storageLocation: true },
  });

  if (record?.storageLocation?.startsWith("s3://")) {
    // Serve from S3 using direct streaming (no temp file)
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "singleton" },
      select: {
        s3Bucket: true,
        s3Region: true,
        s3AccessKeyId: true,
        s3SecretAccessKey: true,
        s3Endpoint: true,
      },
    });

    if (!settings?.s3Bucket || !settings?.s3AccessKeyId || !settings?.s3SecretAccessKey) {
      return new Response("S3 not configured", { status: 500 });
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

    const { key } = parseS3StorageLocation(record.storageLocation);
    const response = await client.send(new GetObjectCommand({
      Bucket: settings.s3Bucket,
      Key: key,
    }));

    if (!response.Body) {
      return new Response("S3 object body is empty", { status: 500 });
    }

    const webStream = response.Body.transformToWebStream();

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safe}"`,
        ...(response.ContentLength ? { "Content-Length": response.ContentLength.toString() } : {}),
      },
    });
  }

  // Local file fallback
  const filePath = path.join(BACKUP_DIR, safe);

  try {
    await fs.access(filePath);
  } catch {
    return new Response("Backup not found", { status: 404 });
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
