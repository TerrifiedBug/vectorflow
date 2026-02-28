import { prisma } from "@/lib/prisma";

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
}) {
  return prisma.auditLog.create({ data: params });
}
