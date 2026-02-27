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

    // Only write audit log on success
    if (result.ok) {
      const userId = ctx.session?.user?.id;
      if (userId) {
        // Extract entityId from the mutation result
        // The raw result data is on result.data which is typed as unknown
        const data = result.data as Record<string, any> | undefined;
        const entityId =
          (data && typeof data === "object" && "id" in data
            ? String(data.id)
            : undefined) ?? "unknown";

        // Fire-and-forget: don't block the response on audit log write
        writeAuditLog({
          userId,
          action,
          entityType,
          entityId,
          metadata: { timestamp: new Date().toISOString() },
        }).catch((err) => {
          console.error("Failed to write audit log:", err);
        });
      }
    }

    return result;
  });
}
