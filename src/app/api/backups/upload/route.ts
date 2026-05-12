export const runtime = "nodejs";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { importBackup } from "@/server/services/backup";

const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 500 MB

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true },
  });

  if (!user?.isSuperAdmin) {
    return jsonError("Forbidden", 403);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonError("Expected multipart/form-data", 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Failed to parse form data", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError("Missing 'file' field in form data", 400);
  }

  if (!file.name.endsWith(".dump")) {
    return jsonError("File must have a .dump extension", 400);
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return jsonError(`File too large. Maximum size is ${MAX_UPLOAD_SIZE / 1024 / 1024} MB`, 400);
  }

  if (file.size === 0) {
    return jsonError("File is empty", 400);
  }

  try {
    const fileStream = file.stream();
    const metadata = await importBackup(fileStream, file.name);

    return new Response(JSON.stringify(metadata), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return jsonError(message, 422);
  }
}
