import { writeAuditLog } from "@/server/services/audit";
import { middleware } from "@/trpc/init";

const SENSITIVE_KEYS = new Set([
  "password", "currentPassword", "newPassword",
  "token", "secret", "key", "keyBase64",
  "passwordHash", "httpsToken", "sshKey",
]);

function sanitizeInput(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(sanitizeInput);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeInput(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * tRPC middleware factory for audit logging.
 *
 * Usage: procedure.use(withAudit("pipeline.created", "Pipeline"))
 *
 * After a successful mutation, writes an audit log entry with the
 * authenticated user's ID, the action, entity type, and entity ID
 * extracted from the mutation result.
 */
export function withAudit(action: string, entityType: string) {
  return middleware(async ({ ctx, getRawInput, next }) => {
    const result = await next();

    if (result.ok) {
      const userId = ctx.session?.user?.id;
      const teamId = (ctx as any).teamId ?? null;
      if (userId) {
        const data = result.data as Record<string, any> | undefined;
        const entityId =
          (data && typeof data === "object" && "id" in data
            ? String(data.id)
            : undefined) ?? "unknown";

        let inputData: unknown;
        try { inputData = await getRawInput(); } catch { /* ignore */ }

        writeAuditLog({
          userId,
          action,
          entityType,
          entityId,
          teamId,
          metadata: {
            timestamp: new Date().toISOString(),
            ...(inputData ? { input: sanitizeInput(inputData) } : {}),
          },
          ipAddress: (ctx as any).ipAddress ?? null,
          userEmail: ctx.session?.user?.email ?? null,
          userName: ctx.session?.user?.name ?? null,
        }).catch(() => {});
      }
    }

    return result;
  });
}
