import { writeAuditLog } from "@/server/services/audit";
import { prisma } from "@/lib/prisma";
import { middleware } from "@/trpc/init";
import { SENSITIVE_KEYS, sanitizeInput, computeDiff } from "./audit-sanitize";
import { warnLog } from "@/lib/logger";

export { SENSITIVE_KEYS, sanitizeInput, computeDiff };
export { resolveTeamId, resolveEnvironmentId };

/**
 * Resolve teamId from procedure input when not already in context.
 * Tries: input.teamId → input.environmentId → input.pipelineId → input.id (by entity type)
 */
async function resolveTeamId(
  inputData: Record<string, unknown> | undefined,
  entityType: string,
  organizationId?: string | null,
): Promise<string | null> {
  if (!inputData) return null;
  const orgFilter = organizationId != null ? { organizationId } : {};

  if (inputData.teamId) return inputData.teamId as string;

  if (inputData.environmentId) {
    const env = await prisma.environment.findFirst({
      where: { id: inputData.environmentId as string, ...orgFilter },
      select: { teamId: true },
    });
    return env?.teamId ?? null;
  }

  if (inputData.pipelineId) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: inputData.pipelineId as string, ...orgFilter },
      select: { environment: { select: { teamId: true } } },
    });
    return pipeline?.environment.teamId ?? null;
  }

  // For delete operations where input.id refers to the entity itself
  if (inputData.id && entityType === "Environment") {
    const env = await prisma.environment.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { teamId: true },
    });
    return env?.teamId ?? null;
  }

  if (inputData.id && entityType === "Pipeline") {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environment: { select: { teamId: true } } },
    });
    return pipeline?.environment.teamId ?? null;
  }

  if (inputData.id && entityType === "VectorNode") {
    const node = await prisma.vectorNode.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    if (node?.environmentId) {
      const env = await prisma.environment.findFirst({
        where: { id: node.environmentId, ...orgFilter },
        select: { teamId: true },
      });
      return env?.teamId ?? null;
    }
  }

  if (inputData.id && entityType === "AlertRule") {
    const rule = await prisma.alertRule.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { teamId: true },
    });
    return rule?.teamId ?? null;
  }

  if (inputData.id && entityType === "NotificationChannel") {
    const channel = await prisma.notificationChannel.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environment: { select: { teamId: true } } },
    });
    return channel?.environment.teamId ?? null;
  }

  if (inputData.id && entityType === "VrlSnippet") {
    const snippet = await prisma.vrlSnippet.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { teamId: true },
    });
    return snippet?.teamId ?? null;
  }

  if (inputData.id && entityType === "ServiceAccount") {
    const sa = await prisma.serviceAccount.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environment: { select: { teamId: true } } },
    });
    return sa?.environment.teamId ?? null;
  }

  // Resolve requestId → DeployRequest → pipeline → environment.teamId
  if (inputData.requestId && entityType === "DeployRequest") {
    const deployReq = await prisma.deployRequest.findFirst({
      where: { id: inputData.requestId as string, ...orgFilter },
      select: { pipeline: { select: { environment: { select: { teamId: true } } } } },
    });
    return deployReq?.pipeline.environment.teamId ?? null;
  }

  return null;
}

/**
 * Defense-in-depth assertion that the team/environment
 * the audit middleware just resolved is actually owned by the caller's
 * organisation. The procedure's own `withTeamAccess` gate already
 * blocks cross-org IDs at request time; this check makes sure that if
 * the gate ever has a bug (or someone introduces a new bypass), the
 * audit row does NOT silently attribute the action to the wrong team.
 *
 * On mismatch: returns null and logs a warning. Caller falls through
 * to writing the audit row with teamId=null + a metadata note.
 */
async function assertTeamBelongsToOrg(
  teamId: string | null,
  organizationId: string | null | undefined,
): Promise<string | null> {
  if (!teamId || !organizationId) return teamId ?? null;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true },
  });
  if (!team) return null;
  if (team.organizationId !== organizationId) {
    warnLog(
      "audit-middleware",
      `cross-org team resolved for audit (teamId=${teamId}, expectedOrg=${organizationId}, actualOrg=${team.organizationId}); dropping teamId from audit row`,
    );
    return null;
  }
  return teamId;
}

async function assertEnvironmentBelongsToOrg(
  environmentId: string | null,
  organizationId: string | null | undefined,
): Promise<string | null> {
  if (!environmentId || !organizationId) return environmentId ?? null;
  const env = await prisma.environment.findUnique({
    where: { id: environmentId },
    select: { organizationId: true },
  });
  if (!env) return null;
  if (env.organizationId !== organizationId) {
    warnLog(
      "audit-middleware",
      `cross-org environment resolved for audit (envId=${environmentId}, expectedOrg=${organizationId}, actualOrg=${env.organizationId}); dropping environmentId from audit row`,
    );
    return null;
  }
  return environmentId;
}

/**
 * Resolve environmentId from procedure input.
 * Tries: input.environmentId → input.pipelineId → input.id (by entity type)
 */
async function resolveEnvironmentId(
  inputData: Record<string, unknown> | undefined,
  entityType: string,
  organizationId?: string | null,
): Promise<string | null> {
  if (!inputData) return null;
  const orgFilter = organizationId != null ? { organizationId } : {};

  if (inputData.environmentId) return inputData.environmentId as string;

  if (inputData.pipelineId) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: inputData.pipelineId as string, ...orgFilter },
      select: { environmentId: true },
    });
    return pipeline?.environmentId ?? null;
  }

  // For operations where input.id refers to the entity itself
  if (inputData.id && entityType === "Environment") {
    return inputData.id as string;
  }

  if (inputData.id && entityType === "Pipeline") {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    return pipeline?.environmentId ?? null;
  }

  if (inputData.id && entityType === "VectorNode") {
    const node = await prisma.vectorNode.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    return node?.environmentId ?? null;
  }

  if (inputData.id && entityType === "Secret") {
    const secret = await prisma.secret.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    return secret?.environmentId ?? null;
  }

  if (inputData.id && entityType === "Certificate") {
    const cert = await prisma.certificate.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    return cert?.environmentId ?? null;
  }

  if (inputData.id && entityType === "AlertRule") {
    const rule = await prisma.alertRule.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    return rule?.environmentId ?? null;
  }

  if (inputData.id && entityType === "NotificationChannel") {
    const channel = await prisma.notificationChannel.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    return channel?.environmentId ?? null;
  }

  if (inputData.id && entityType === "ServiceAccount") {
    const sa = await prisma.serviceAccount.findFirst({
      where: { id: inputData.id as string, ...orgFilter },
      select: { environmentId: true },
    });
    return sa?.environmentId ?? null;
  }

  // Resolve requestId → DeployRequest → environmentId
  if (inputData.requestId && entityType === "DeployRequest") {
    const deployReq = await prisma.deployRequest.findFirst({
      where: { id: inputData.requestId as string, ...orgFilter },
      select: { environmentId: true },
    });
    return deployReq?.environmentId ?? null;
  }

  return null;
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
  NotificationChannel: (id) =>
    prisma.notificationChannel.findUnique({
      where: { id },
      select: {
        id: true, name: true, type: true, environmentId: true,
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
  ServiceAccount: (id) =>
    prisma.serviceAccount.findUnique({
      where: { id },
      select: {
        id: true, name: true, description: true, keyPrefix: true,
        environmentId: true, permissions: true, enabled: true,
        expiresAt: true, createdAt: true,
      },
    }) as Promise<Record<string, unknown> | null>,
  DeployRequest: (id) =>
    prisma.deployRequest.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>,
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
    const callerOrgId = (ctx as Record<string, unknown>).organizationId as string | undefined;
    let resolvedTeamId: string | null = ctxTeamId;
    let resolvedEnvironmentId: string | null = null;
    if (action.includes("deleted")) {
      try {
        if (!resolvedTeamId) {
          resolvedTeamId = await resolveTeamId(
            inputData as Record<string, unknown> | undefined,
            entityType,
            callerOrgId,
          );
        }
        resolvedEnvironmentId = await resolveEnvironmentId(
          inputData as Record<string, unknown> | undefined,
          entityType,
          callerOrgId,
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
          input?.requestId ??
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
              callerOrgId,
            );
          } catch { /* ignore */ }
        }

        let environmentId = resolvedEnvironmentId;
        if (!environmentId) {
          try {
            environmentId = await resolveEnvironmentId(
              inputData as Record<string, unknown> | undefined,
              entityType,
              callerOrgId,
            );
          } catch { /* ignore */ }
        }

        // Defense-in-depth org-belongs check on the
        // resolved IDs before they hit the audit log.
        const verifiedTeamId = await assertTeamBelongsToOrg(teamId, callerOrgId);
        const verifiedEnvironmentId = await assertEnvironmentBelongsToOrg(
          environmentId,
          callerOrgId,
        );
        const auditMetadataExtra: Record<string, unknown> = {};
        if (teamId && verifiedTeamId === null) {
          auditMetadataExtra.crossOrgTeamResolved = teamId;
        }
        if (environmentId && verifiedEnvironmentId === null) {
          auditMetadataExtra.crossOrgEnvironmentResolved = environmentId;
        }

        writeAuditLog({
          userId,
          action,
          entityType,
          entityId,
          diff: diff ?? undefined,
          teamId: verifiedTeamId,
          environmentId: verifiedEnvironmentId,
          metadata: {
            timestamp: new Date().toISOString(),
            ...((ctx as Record<string, unknown>).auditMetadata
              ? (ctx as Record<string, unknown>).auditMetadata as Record<string, unknown>
              : inputData ? { input: sanitizeInput(inputData) } : {}),
            ...auditMetadataExtra,
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
