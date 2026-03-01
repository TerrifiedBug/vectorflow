import { writeAuditLog } from "@/server/services/audit";
import { prisma } from "@/lib/prisma";
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
 * Resolve teamId from procedure input when not already in context.
 * Tries: input.teamId → input.environmentId → input.pipelineId → input.id (by entity type)
 */
async function resolveTeamId(
  inputData: Record<string, unknown> | undefined,
  entityType: string,
): Promise<string | null> {
  if (!inputData) return null;

  if (inputData.teamId) return inputData.teamId as string;

  if (inputData.environmentId) {
    const env = await prisma.environment.findUnique({
      where: { id: inputData.environmentId as string },
      select: { teamId: true },
    });
    return env?.teamId ?? null;
  }

  if (inputData.pipelineId) {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: inputData.pipelineId as string },
      select: { environment: { select: { teamId: true } } },
    });
    return pipeline?.environment.teamId ?? null;
  }

  // For delete operations where input.id refers to the entity itself
  if (inputData.id && entityType === "Environment") {
    const env = await prisma.environment.findUnique({
      where: { id: inputData.id as string },
      select: { teamId: true },
    });
    return env?.teamId ?? null;
  }

  if (inputData.id && entityType === "Pipeline") {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: inputData.id as string },
      select: { environment: { select: { teamId: true } } },
    });
    return pipeline?.environment.teamId ?? null;
  }

  if (inputData.id && entityType === "VectorNode") {
    const node = await prisma.vectorNode.findUnique({
      where: { id: inputData.id as string },
      select: { environmentId: true },
    });
    if (node?.environmentId) {
      const env = await prisma.environment.findUnique({
        where: { id: node.environmentId },
        select: { teamId: true },
      });
      return env?.teamId ?? null;
    }
  }

  return null;
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
    // Capture input before the mutation (entity may be deleted after)
    let inputData: unknown;
    try { inputData = await getRawInput(); } catch { /* ignore */ }

    // Pre-resolve teamId for delete operations (entity won't exist after next())
    const ctxTeamId = (ctx as any).teamId ?? null;
    let resolvedTeamId: string | null = ctxTeamId;
    if (!resolvedTeamId && action.includes("deleted")) {
      try {
        resolvedTeamId = await resolveTeamId(
          inputData as Record<string, unknown> | undefined,
          entityType,
        );
      } catch { /* ignore */ }
    }

    const result = await next();

    if (result.ok) {
      const userId = ctx.session?.user?.id;
      if (userId) {
        const data = result.data as Record<string, any> | undefined;
        const input = inputData as Record<string, any> | undefined;

        // Extract entity ID: prefer result.id, fall back to input fields
        const entityId =
          (data && typeof data === "object" && "id" in data
            ? String(data.id)
            : undefined) ??
          input?.id ??
          input?.userId ??
          input?.teamId ??
          input?.pipelineId ??
          input?.versionId ??
          userId;

        // Resolve teamId if not yet known
        let teamId = resolvedTeamId;
        if (!teamId) {
          try {
            teamId = await resolveTeamId(
              inputData as Record<string, unknown> | undefined,
              entityType,
            );
          } catch { /* ignore */ }
        }

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
