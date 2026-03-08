import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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
