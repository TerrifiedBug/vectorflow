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

  if (inputData.id && (entityType === "AlertRule" || entityType === "AlertWebhook")) {
    if (entityType === "AlertRule") {
      const rule = await prisma.alertRule.findUnique({
        where: { id: inputData.id as string },
        select: { teamId: true },
      });
      return rule?.teamId ?? null;
    }
    const webhook = await prisma.alertWebhook.findUnique({
      where: { id: inputData.id as string },
      select: { environment: { select: { teamId: true } } },
    });
    return webhook?.environment.teamId ?? null;
  }

  if (inputData.id && entityType === "VrlSnippet") {
    const snippet = await prisma.vrlSnippet.findUnique({
      where: { id: inputData.id as string },
      select: { teamId: true },
    });
    return snippet?.teamId ?? null;
  }

  return null;
}

/**
 * Resolve environmentId from procedure input.
 * Tries: input.environmentId → input.pipelineId → input.id (by entity type)
 */
async function resolveEnvironmentId(
  inputData: Record<string, unknown> | undefined,
  entityType: string,
): Promise<string | null> {
  if (!inputData) return null;

  if (inputData.environmentId) return inputData.environmentId as string;

  if (inputData.pipelineId) {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: inputData.pipelineId as string },
      select: { environmentId: true },
    });
    return pipeline?.environmentId ?? null;
  }

  // For operations where input.id refers to the entity itself
  if (inputData.id && entityType === "Environment") {
    return inputData.id as string;
  }

  if (inputData.id && entityType === "Pipeline") {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: inputData.id as string },
      select: { environmentId: true },
    });
    return pipeline?.environmentId ?? null;
  }

  if (inputData.id && entityType === "VectorNode") {
    const node = await prisma.vectorNode.findUnique({
      where: { id: inputData.id as string },
      select: { environmentId: true },
    });
    return node?.environmentId ?? null;
  }

  if (inputData.id && entityType === "Secret") {
    const secret = await prisma.secret.findUnique({
      where: { id: inputData.id as string },
      select: { environmentId: true },
    });
    return secret?.environmentId ?? null;
  }

  if (inputData.id && entityType === "Certificate") {
    const cert = await prisma.certificate.findUnique({
      where: { id: inputData.id as string },
      select: { environmentId: true },
    });
    return cert?.environmentId ?? null;
  }

  if (inputData.id && entityType === "AlertRule") {
    const rule = await prisma.alertRule.findUnique({
      where: { id: inputData.id as string },
      select: { environmentId: true },
    });
    return rule?.environmentId ?? null;
  }

  if (inputData.id && entityType === "AlertWebhook") {
    const webhook = await prisma.alertWebhook.findUnique({
      where: { id: inputData.id as string },
      select: { environmentId: true },
    });
    return webhook?.environmentId ?? null;
  }

  return null;
}

/**
 * Compute a shallow diff between two entity snapshots.
 * Returns only fields that changed, with { old, new } values.
 */
function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> | null {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (key === "updatedAt" || key === "createdAt") continue;
    if (SENSITIVE_KEYS.has(key)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        diff[key] = { old: "[REDACTED]", new: "[REDACTED]" };
      }
      continue;
    }

    const oldVal = before[key];
    const newVal = after[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

/**
 * Map entity types to their Prisma loaders for diff snapshots.
 * Sensitive fields excluded at query level.
 */
const ENTITY_LOADERS: Record<string, (id: string) => Promise<Record<string, unknown> | null>> = {
  Pipeline: (id) =>
    prisma.pipeline.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
  VrlSnippet: (id) =>
    prisma.vrlSnippet.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
  User: (id) =>
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true,
        authMethod: true, mustChangePassword: true,
        totpEnabled: true,
      },
    }) as Promise<Record<string, unknown> | null>,
  VectorNode: (id) =>
    prisma.vectorNode.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
  Environment: (id) =>
    prisma.environment.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
  Secret: (id) =>
    prisma.secret.findUnique({
      where: { id },
      select: {
        id: true, name: true, environmentId: true, createdAt: true, updatedAt: true,
      },
    }) as Promise<Record<string, unknown> | null>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SystemSettings: (_id) =>
    prisma.systemSettings.findFirst() as Promise<Record<string, unknown> | null>,
  AlertRule: (id) =>
    prisma.alertRule.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
  AlertWebhook: (id) =>
    prisma.alertWebhook.findUnique({
      where: { id },
      select: {
        id: true, url: true, environmentId: true,
        enabled: true, createdAt: true, updatedAt: true,
      },
    }) as Promise<Record<string, unknown> | null>,
  Certificate: (id) =>
    prisma.certificate.findUnique({
      where: { id },
      select: {
        id: true, name: true, environmentId: true,
        createdAt: true,
      },
    }) as Promise<Record<string, unknown> | null>,
  Team: (id) =>
    prisma.team.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
  Template: (id) =>
    prisma.template.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
};

async function loadEntity(
  entityType: string,
  entityId: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!entityId) return null;
  const loader = ENTITY_LOADERS[entityType];
  if (!loader) return null;
  try {
    return await loader(entityId);
  } catch {
    return null;
  }
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
    let inputData: unknown;
    try { inputData = await getRawInput(); } catch { /* ignore */ }

    const input = inputData as Record<string, unknown> | undefined;
    const preloadId = input?.id ?? input?.pipelineId ?? input?.userId;

    const ctxTeamId = (ctx as Record<string, unknown>).teamId as string | null ?? null;
    let resolvedTeamId: string | null = ctxTeamId;
    let resolvedEnvironmentId: string | null = null;
    if (action.includes("deleted")) {
      try {
        if (!resolvedTeamId) {
          resolvedTeamId = await resolveTeamId(
            inputData as Record<string, unknown> | undefined,
            entityType,
          );
        }
        resolvedEnvironmentId = await resolveEnvironmentId(
          inputData as Record<string, unknown> | undefined,
          entityType,
        );
      } catch { /* ignore */ }
    }

    // Snapshot before mutation (only for update actions)
    const isUpdate = !action.includes("created") && !action.includes("deleted");
    let beforeSnapshot: Record<string, unknown> | null = null;
    if (isUpdate && preloadId) {
      beforeSnapshot = await loadEntity(entityType, preloadId as string);
    }

    const result = await next();

    if (result.ok) {
      const userId = ctx.session?.user?.id;
      if (userId) {
        const data = result.data as Record<string, unknown> | undefined;

        const entityId = (
          (data && typeof data === "object" && "id" in data
            ? String(data.id)
            : undefined) ??
          input?.id ??
          input?.userId ??
          input?.teamId ??
          input?.pipelineId ??
          input?.versionId ??
          userId
        ) as string;

        // Compute diff for update operations
        let diff: Record<string, { old: unknown; new: unknown }> | null = null;
        if (isUpdate && beforeSnapshot) {
          const afterSnapshot = await loadEntity(entityType, entityId);
          if (afterSnapshot) {
            diff = computeDiff(beforeSnapshot, afterSnapshot);
          }
        }

        let teamId = resolvedTeamId;
        if (!teamId) {
          try {
            teamId = await resolveTeamId(
              inputData as Record<string, unknown> | undefined,
              entityType,
            );
          } catch { /* ignore */ }
        }

        let environmentId = resolvedEnvironmentId;
        if (!environmentId) {
          try {
            environmentId = await resolveEnvironmentId(
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
          diff: diff ?? undefined,
          teamId,
          environmentId,
          metadata: {
            timestamp: new Date().toISOString(),
            ...(inputData ? { input: sanitizeInput(inputData) } : {}),
          },
          ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
          userEmail: ctx.session?.user?.email ?? null,
          userName: ctx.session?.user?.name ?? null,
        }).catch(() => {});
      }
    }

    return result;
  });
}
