import { appendFile } from "fs/promises";
import { prisma } from "@/lib/prisma";

const AUDIT_LOG_PATH =
  process.env.VF_AUDIT_LOG_PATH ?? "/var/lib/vectorflow/audit.jsonl";

export async function writeAuditLog(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  teamId?: string | null;
  environmentId?: string | null;
}) {
  const log = await prisma.auditLog.create({ data: params });

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

  try {
    await appendFile(AUDIT_LOG_PATH, jsonLine);
  } catch (error) {
    // File write failure should not break audit logging to DB
    console.error("Failed to append audit event to file:", AUDIT_LOG_PATH, error);
  }

  return log;
}
