import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface ServiceAccountContext {
  serviceAccountId: string;
  serviceAccountName: string;
  environmentId: string;
  permissions: string[];
  rateLimit: number | null;
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
    rateLimit: sa.rateLimit ?? null,
  };
}

export function hasPermission(
  ctx: ServiceAccountContext,
  permission: string,
): boolean {
  return ctx.permissions.includes(permission);
}

/** All valid service account permission strings. */
export const VALID_PERMISSIONS = [
  // Existing
  "pipelines.read",
  "pipelines.deploy",
  "nodes.read",
  "nodes.manage",
  "secrets.read",
  "secrets.manage",
  "alerts.read",
  "alerts.manage",
  "audit.read",
  // New (API v1 completeness)
  "pipelines.write",
  "pipelines.promote",
  "metrics.read",
  "deploy-requests.manage",
  "node-groups.read",
  "node-groups.manage",
  "environments.read",
] as const;

export type Permission = (typeof VALID_PERMISSIONS)[number];
