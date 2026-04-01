import { appendFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { errorLog } from "@/lib/logger";

export const AUDIT_LOG_PATH =
  process.env.VF_AUDIT_LOG_PATH ??
  join(process.cwd(), ".vectorflow", "audit.jsonl");

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

  try {
    await mkdir(dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, jsonLine);
  } catch (error) {
    // File write failure should not break audit logging to DB
    errorLog("audit", `Failed to append audit event to file: ${AUDIT_LOG_PATH}`, error);
  }

  return log;
}
