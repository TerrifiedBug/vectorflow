import { writeAuditLog } from "@/server/services/audit";
import { middleware } from "@/trpc/init";

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
  return middleware(async ({ ctx, next }) => {
    const result = await next();

    if (result.ok) {
      const userId = ctx.session?.user?.id;
      if (userId) {
        const data = result.data as Record<string, any> | undefined;
        const entityId =
          (data && typeof data === "object" && "id" in data
            ? String(data.id)
            : undefined) ?? "unknown";

        writeAuditLog({
          userId,
          action,
          entityType,
          entityId,
          metadata: { timestamp: new Date().toISOString() },
        }).catch(() => {});
      }
    }

    return result;
  });
}
