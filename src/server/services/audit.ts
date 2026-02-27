import { prisma } from "@/lib/prisma";

export async function writeAuditLog(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, any>;
  metadata?: Record<string, any>;
}) {
  return prisma.auditLog.create({ data: params });
}
