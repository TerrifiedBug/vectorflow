import crypto from "crypto";
import { adminPrisma } from "@/lib/prisma";
import {
  SERVICE_ACCOUNT_PERMISSIONS,
  type ServiceAccountPermission,
} from "@/lib/service-account-permissions";

export interface ServiceAccountContext {
  serviceAccountId: string;
  serviceAccountName: string;
  environmentId: string;
  /**
   * Org that owns the ServiceAccount. Threaded through so v3 envelope
   * encryption can be loaded against the right DEK without re-fetching
   * the row at every API callsite.
   */
  organizationId: string;
  permissions: string[];
  rateLimit: number | null;
}

export async function authenticateApiKey(
  authHeader: string | null,
): Promise<ServiceAccountContext | null> {
  if (!authHeader?.startsWith("Bearer vf_")) return null;

  const rawKey = authHeader.slice(7);
  const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");

  // ServiceAccount is a fenced tenant table and this lookup resolves the org
  // BEFORE any scope exists — keyed by the SHA256 of the bearer key (an
  // unguessable secret), so it runs on the admin connection. The caller wraps
  // the request handler in runWithOrgContext(ctx.organizationId) afterwards.
  const sa = await adminPrisma.serviceAccount.findUnique({ where: { hashedKey } });
  if (!sa || !sa.enabled) return null;
  if (sa.expiresAt && sa.expiresAt < new Date()) return null;

  // Fire-and-forget lastUsedAt update (admin: a metadata touch outside scope).
  adminPrisma.serviceAccount
    .update({
      where: { id: sa.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    serviceAccountId: sa.id,
    serviceAccountName: sa.name,
    environmentId: sa.environmentId,
    organizationId: sa.organizationId,
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
export const VALID_PERMISSIONS = SERVICE_ACCOUNT_PERMISSIONS;

export type Permission = ServiceAccountPermission;
