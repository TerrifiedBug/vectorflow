import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { errorLog } from "@/lib/logger";
import { env } from "@/lib/env";

// Deferred so process.cwd() is not evaluated at module load time.
// The Edge bundler traces into this file (via auto-rollback.ts → instrumentation.ts)
// and rejects any Node-only API that runs during module evaluation.
let _auditLogPath: string | null = null;
export function getAuditLogPath(): string {
  if (_auditLogPath === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("path") as typeof import("path");
    _auditLogPath =
      env.VF_AUDIT_LOG_PATH ?? join(process.cwd(), ".vectorflow", "audit.jsonl");
  }
  return _auditLogPath;
}

export async function writeAuditLog(params: {
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, { old: unknown; new: unknown }>;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  teamId?: string | null;
  environmentId?: string | null;
}) {
  const log = await prisma.auditLog.create({
    data: {
      ...params,
      diff: params.diff as unknown as Prisma.InputJsonValue,
      metadata: params.metadata as unknown as Prisma.InputJsonValue,
    },
  });

  const jsonLine =
    JSON.stringify({
      id: log.id,
      timestamp: log.createdAt.toISOString(),
      action: log.action,
      userId: log.userId,
      userEmail: log.userEmail,
      userName: log.userName,
      entityType: log.entityType,
      entityId: log.entityId,
      teamId: log.teamId,
      environmentId: log.environmentId,
      ipAddress: log.ipAddress,
      metadata: log.metadata,
      diff: log.diff,
    }) + "\n";

  const auditLogPath = getAuditLogPath();
  try {
    // Dynamically import Node-only fs modules to keep this file Edge-bundle safe.
    const { appendFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    await mkdir(dirname(auditLogPath), { recursive: true });
    await appendFile(auditLogPath, jsonLine);
  } catch (error) {
    // File write failure should not break audit logging to DB
    errorLog("audit", `Failed to append audit event to file: ${auditLogPath}`, error);
  }

  return log;
}
