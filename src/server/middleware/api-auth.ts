import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface ServiceAccountContext {
  serviceAccountId: string;
  serviceAccountName: string;
  environmentId: string;
  permissions: string[];
}

export async function authenticateApiKey(
  authHeader: string | null,
): Promise<ServiceAccountContext | null> {
  if (!authHeader?.startsWith("Bearer vf_")) return null;

  const rawKey = authHeader.slice(7);
  const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");

  const sa = await prisma.serviceAccount.findUnique({ where: { hashedKey } });
  if (!sa || !sa.enabled) return null;
  if (sa.expiresAt && sa.expiresAt < new Date()) return null;

  // Fire-and-forget lastUsedAt update
  prisma.serviceAccount
    .update({
      where: { id: sa.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    serviceAccountId: sa.id,
    serviceAccountName: sa.name,
    environmentId: sa.environmentId,
    permissions: sa.permissions as string[],
  };
}

export function hasPermission(
  ctx: ServiceAccountContext,
  permission: string,
): boolean {
  return ctx.permissions.includes(permission);
}
