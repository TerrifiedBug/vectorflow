import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

/** Actions that represent deployment lifecycle events */
export const DEPLOYMENT_ACTIONS = [
  "deploy.agent",
  "deploy.from_version",
  "deploy.undeploy",
  "deploy.request_submitted",
  "deployRequest.approved",
  "deployRequest.deployed",
  "deployRequest.rejected",
  "deploy.cancel_request",
  "pipeline.rollback",
  "deploy.staged_created",
  "deploy.staged_broadened",
  "deploy.staged_rolled_back",
  "deploy.auto_rollback",
] as const;

type AuditScope = {
  isSuperAdmin: boolean;
  teamIds: string[];
};

const emptyAuditScope = { id: { in: [] } };

async function getAuditScope(userId: string | undefined | null): Promise<AuditScope> {
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    }),
    prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    }),
  ]);

  return {
    isSuperAdmin: user?.isSuperAdmin === true,
    teamIds: (memberships ?? []).map((membership) => membership.teamId),
  };
}

function auditScopeCondition(scope: AuditScope) {
  if (scope.isSuperAdmin) return null;
  if (scope.teamIds.length === 0) return emptyAuditScope;

  return {
    OR: [
      { teamId: { in: scope.teamIds } },
      { environment: { teamId: { in: scope.teamIds } } },
    ],
  };
}

function pushAuditScope(conditions: Record<string, unknown>[], scope: AuditScope) {
  const scopeCondition = auditScopeCondition(scope);
  if (scopeCondition) {
    conditions.push(scopeCondition);
  }
}

export const auditRouter = router({
  /** Full detail for a single audit entry, scoped to a team (for the entry drawer). */
  getDetail: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const entry = await prisma.auditLog.findUnique({
        where: { id: input.id },
        include: {
          user: { select: { name: true, email: true } },
          environment: { select: { teamId: true } },
        },
      });
      if (!entry) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Cross-team enumeration guard: even if the caller has access to `input.teamId`
      // via the middleware, refuse to return entries that belong to a different team.
      const scopedTeamId = entry.teamId ?? entry.environment?.teamId ?? null;
      if (scopedTeamId !== input.teamId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return entry;
    }),

  list: protectedProcedure
    .input(
      z.object({
        action: z.string().optional(),
        userId: z.string().optional(),
        entityTypes: z.array(z.string()).optional(),
        search: z.string().optional(),
        teamId: z.string().optional(),
        environmentId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(100),
      })
    )
    .query(async ({ input, ctx }) => {
      const userIdFromSession = ctx.session?.user?.id;
      const scope = await getAuditScope(userIdFromSession);
      const {
        action,
        userId,
        entityTypes,
        search,
        startDate,
        endDate,
        cursor,
        limit,
      } = input;
      const take = limit;

      const conditions: Record<string, unknown>[] = [];
      pushAuditScope(conditions, scope);

      if (action) {
        conditions.push({ action });
      }

      if (userId) {
        conditions.push({ userId });
      }

      if (entityTypes && entityTypes.length > 0) {
        conditions.push({ entityType: { in: entityTypes } });
      }

      if (input.teamId) {
        conditions.push({ teamId: input.teamId });
      }

      if (input.environmentId) {
        conditions.push({ environmentId: input.environmentId });
      }

      if (startDate || endDate) {
        const createdAt: Record<string, Date> = {};
        if (startDate) {
          createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          createdAt.lte = new Date(endDate);
        }
        conditions.push({ createdAt });
      }

      if (search) {
        conditions.push({
          OR: [
            { action: { contains: search, mode: "insensitive" } },
            { entityType: { contains: search, mode: "insensitive" } },
            { entityId: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      // Hide noisy successful SCIM provisioning entries from the default view.
      // Failed SCIM events stay visible so operators can debug IdP sync issues.
      const isScimFilter =
        action?.startsWith("scim.") ||
        entityTypes?.some((t) => t === "ScimUser" || t === "ScimGroup") ||
        search?.toLowerCase().includes("scim");
      if (!isScimFilter) {
        conditions.push({
          NOT: {
            AND: [
              { action: { startsWith: "scim." } },
              { metadata: { path: ["status"], equals: "success" } },
            ],
          },
        });
      }

      const where = conditions.length > 0 ? { AND: conditions } : {};

      const items = await prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > take) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return {
        items,
        nextCursor,
      };
    }),

  /** Distinct action values for filter dropdown */
  actions: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session?.user?.id;
    const scope = await getAuditScope(userId);
    const scopeCondition = auditScopeCondition(scope);
    const results = await prisma.auditLog.findMany({
      ...(scopeCondition ? { where: scopeCondition } : {}),
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    });
    return results.map((r) => r.action);
  }),

  /** Distinct entity type values for filter dropdown */
  entityTypes: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session?.user?.id;
    const scope = await getAuditScope(userId);
    const scopeCondition = auditScopeCondition(scope);
    const results = await prisma.auditLog.findMany({
      ...(scopeCondition ? { where: scopeCondition } : {}),
      select: { entityType: true },
      distinct: ["entityType"],
      orderBy: { entityType: "asc" },
    });
    return results.map((r) => r.entityType);
  }),

  /** Distinct users who have audit log entries */
  users: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session?.user?.id;
    const scope = await getAuditScope(userId);
    const scopeCondition = auditScopeCondition(scope);
    const results = await prisma.auditLog.findMany({
      where: {
        AND: [
          ...(scopeCondition ? [scopeCondition] : []),
          { userId: { not: null } },
        ],
      },
      select: {
        user: { select: { id: true, name: true, email: true } },
      },
      distinct: ["userId"],
    });
    return results.map((r) => r.user).filter((u): u is NonNullable<typeof u> => u !== null);
  }),

  /** Deployment history: audit entries filtered to deployment-related actions */
  deployments: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      const scope = await getAuditScope(userId);
      const { pipelineId, startDate, endDate, cursor } = input;
      const take = 50;

      const conditions: Record<string, unknown>[] = [
        { action: { in: [...DEPLOYMENT_ACTIONS] } },
      ];
      pushAuditScope(conditions, scope);

      if (startDate || endDate) {
        const createdAt: Record<string, Date> = {};
        if (startDate) {
          createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          createdAt.lte = new Date(endDate);
        }
        conditions.push({ createdAt });
      }

      // If pipelineId is provided, filter audit logs that reference this pipeline.
      // Audit logs reference pipelines either via entityId (for Pipeline entity type)
      // or via metadata.input.pipelineId (for DeployRequest entity type).
      if (pipelineId) {
        conditions.push({
          OR: [
            { entityType: "Pipeline", entityId: pipelineId },
            { entityType: "DeployRequest", entityId: pipelineId },
          ],
        });
      }

      const where = { AND: conditions };

      const items = await prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > take) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      // Collect unique pipeline IDs from entityId values and metadata
      const pipelineIds = new Set<string>();
      for (const item of items) {
        if (item.entityType === "Pipeline" && item.entityId) {
          pipelineIds.add(item.entityId);
        }
        const meta = item.metadata as Record<string, unknown> | null;
        const metaInput = meta?.input as Record<string, unknown> | undefined;
        if (metaInput?.pipelineId && typeof metaInput.pipelineId === "string") {
          pipelineIds.add(metaInput.pipelineId);
        }
      }

      // Batch-fetch pipeline names
      const pipelines = pipelineIds.size > 0
        ? await prisma.pipeline.findMany({
            where: { id: { in: [...pipelineIds] } },
            select: { id: true, name: true },
          })
        : [];
      const pipelineMap = new Map(pipelines.map((p) => [p.id, p.name]));

      // Collect unique node IDs from metadata.pushedNodeIds across all items
      const allNodeIds = new Set<string>();
      for (const item of items) {
        const meta = item.metadata as Record<string, unknown> | null;
        const pushed = meta?.pushedNodeIds;
        if (Array.isArray(pushed)) {
          for (const id of pushed) {
            if (typeof id === "string") allNodeIds.add(id);
          }
        }
      }

      // Batch-fetch VectorNode names
      const nodeMap = new Map<string, string>();
      if (allNodeIds.size > 0) {
        const nodes = await prisma.vectorNode.findMany({
          where: { id: { in: [...allNodeIds] } },
          select: { id: true, name: true },
        });
        for (const node of nodes) {
          nodeMap.set(node.id, node.name);
        }
      }

      // Enrich items with pipeline name and extracted version info from metadata
      const enrichedItems = items.map((item) => {
        const meta = item.metadata as Record<string, unknown> | null;
        const metaInput = meta?.input as Record<string, unknown> | undefined;

        // Determine the pipeline ID: for Pipeline entity type use entityId,
        // for DeployRequest use metadata.input.pipelineId
        const itemPipelineId =
          item.entityType === "Pipeline"
            ? item.entityId
            : typeof metaInput?.pipelineId === "string"
              ? metaInput.pipelineId
              : null;

        // Resolve pushedNodeIds to human-readable names
        const pushed = meta?.pushedNodeIds;
        const pushedNodeNames: string[] | null = Array.isArray(pushed)
          ? pushed
              .filter((id): id is string => typeof id === "string")
              .map((id) => nodeMap.get(id) ?? id)
          : null;

        return {
          ...item,
          pipelineName: itemPipelineId ? pipelineMap.get(itemPipelineId) ?? null : null,
          pipelineId: itemPipelineId,
          versionInfo: metaInput?.newVersion
            ? String(metaInput.newVersion)
            : metaInput?.sourceVersionId
              ? String(metaInput.sourceVersionId)
              : metaInput?.version
                ? String(metaInput.version)
                : metaInput?.versionNumber
                  ? String(metaInput.versionNumber)
                  : null,
          changelog: typeof metaInput?.changelog === "string" ? metaInput.changelog : null,
          pushedNodeNames,
        };
      });

      return {
        items: enrichedItems,
        nextCursor,
      };
    }),

  /** Distinct pipelines that have deployment audit entries, for filter dropdown */
  deploymentPipelines: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session?.user?.id;
    const scope = await getAuditScope(userId);
    const scopeCondition = auditScopeCondition(scope);
    // Get distinct entityIds from deployment audit logs for Pipeline entity type
    const pipelineAudits = await prisma.auditLog.findMany({
      where: {
        AND: [
          ...(scopeCondition ? [scopeCondition] : []),
          { action: { in: [...DEPLOYMENT_ACTIONS] } },
          { entityType: "Pipeline" },
        ],
      },
      select: { entityId: true },
      distinct: ["entityId"],
    });

    const pipelineIds = pipelineAudits.map((a) => a.entityId);
    if (pipelineIds.length === 0) return [];

    const pipelines = await prisma.pipeline.findMany({
      where: {
        id: { in: pipelineIds },
        ...(scope.isSuperAdmin
          ? {}
          : { environment: { teamId: { in: scope.teamIds } } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return pipelines;
  }),

  /** Summary stats for deployment activity in the last 24 hours */
  deploymentSummary: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session?.user?.id;
    const scope = await getAuditScope(userId);
    const scopeCondition = auditScopeCondition(scope);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const items = await prisma.auditLog.findMany({
      where: {
        AND: [
          ...(scopeCondition ? [scopeCondition] : []),
          { action: { in: [...DEPLOYMENT_ACTIONS] } },
          { createdAt: { gte: twentyFourHoursAgo } },
        ],
      },
      select: {
        userId: true,
        entityType: true,
        entityId: true,
        metadata: true,
      },
    });

    // Compute aggregates in JS
    const uniqueDeployers = new Set<string>();
    const affectedPipelines = new Set<string>();

    for (const item of items) {
      if (item.userId) {
        uniqueDeployers.add(item.userId);
      }
      if (item.entityType === "Pipeline" && item.entityId) {
        affectedPipelines.add(item.entityId);
      }
      const meta = item.metadata as Record<string, unknown> | null;
      const metaInput = meta?.input as Record<string, unknown> | undefined;
      if (metaInput?.pipelineId && typeof metaInput.pipelineId === "string") {
        affectedPipelines.add(metaInput.pipelineId);
      }
    }

    return {
      deployCount: items.length,
      uniqueDeployers: uniqueDeployers.size,
      affectedPipelines: affectedPipelines.size,
    };
  }),

  /** Export deployment history — same filters as deployments but returns all records (up to 10,000), no cursor */
  exportDeployments: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      const scope = await getAuditScope(userId);
      const { pipelineId, startDate, endDate } = input;
      const maxExportRows = 10_000;

      const conditions: Record<string, unknown>[] = [
        { action: { in: [...DEPLOYMENT_ACTIONS] } },
      ];
      pushAuditScope(conditions, scope);

      if (startDate || endDate) {
        const createdAt: Record<string, Date> = {};
        if (startDate) {
          createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          createdAt.lte = new Date(endDate);
        }
        conditions.push({ createdAt });
      }

      if (pipelineId) {
        conditions.push({
          OR: [
            { entityType: "Pipeline", entityId: pipelineId },
            { entityType: "DeployRequest", entityId: pipelineId },
          ],
        });
      }

      const where = { AND: conditions };

      const items = await prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: maxExportRows,
      });

      // Collect unique pipeline IDs from entityId values and metadata
      const pipelineIds = new Set<string>();
      for (const item of items) {
        if (item.entityType === "Pipeline" && item.entityId) {
          pipelineIds.add(item.entityId);
        }
        const meta = item.metadata as Record<string, unknown> | null;
        const metaInput = meta?.input as Record<string, unknown> | undefined;
        if (metaInput?.pipelineId && typeof metaInput.pipelineId === "string") {
          pipelineIds.add(metaInput.pipelineId);
        }
      }

      // Batch-fetch pipeline names
      const pipelines = pipelineIds.size > 0
        ? await prisma.pipeline.findMany({
            where: { id: { in: [...pipelineIds] } },
            select: { id: true, name: true },
          })
        : [];
      const pipelineMap = new Map(pipelines.map((p) => [p.id, p.name]));

      // Collect unique node IDs from metadata.pushedNodeIds across all items
      const exportNodeIds = new Set<string>();
      for (const item of items) {
        const meta = item.metadata as Record<string, unknown> | null;
        const pushed = meta?.pushedNodeIds;
        if (Array.isArray(pushed)) {
          for (const id of pushed) {
            if (typeof id === "string") exportNodeIds.add(id);
          }
        }
      }

      // Batch-fetch VectorNode names
      const exportNodeMap = new Map<string, string>();
      if (exportNodeIds.size > 0) {
        const nodes = await prisma.vectorNode.findMany({
          where: { id: { in: [...exportNodeIds] } },
          select: { id: true, name: true },
        });
        for (const node of nodes) {
          exportNodeMap.set(node.id, node.name);
        }
      }

      // Enrich items with pipeline name and extracted version info from metadata
      const enrichedItems = items.map((item) => {
        const meta = item.metadata as Record<string, unknown> | null;
        const metaInput = meta?.input as Record<string, unknown> | undefined;

        const itemPipelineId =
          item.entityType === "Pipeline"
            ? item.entityId
            : typeof metaInput?.pipelineId === "string"
              ? metaInput.pipelineId
              : null;

        // Resolve pushedNodeIds to human-readable names
        const pushed = meta?.pushedNodeIds;
        const pushedNodeNames: string[] | null = Array.isArray(pushed)
          ? pushed
              .filter((id): id is string => typeof id === "string")
              .map((id) => exportNodeMap.get(id) ?? id)
          : null;

        return {
          ...item,
          pipelineName: itemPipelineId ? pipelineMap.get(itemPipelineId) ?? null : null,
          pipelineId: itemPipelineId,
          versionInfo: metaInput?.newVersion
            ? String(metaInput.newVersion)
            : metaInput?.sourceVersionId
              ? String(metaInput.sourceVersionId)
              : metaInput?.version
                ? String(metaInput.version)
                : metaInput?.versionNumber
                  ? String(metaInput.versionNumber)
                  : null,
          changelog: typeof metaInput?.changelog === "string" ? metaInput.changelog : null,
          pushedNodeNames,
        };
      });

      return { items: enrichedItems };
    }),

  /** Export audit log entries — same filters as list but returns all records (up to 10,000), no cursor */
  exportAuditLog: protectedProcedure
    .input(
      z.object({
        action: z.string().optional(),
        userId: z.string().optional(),
        entityTypes: z.array(z.string()).optional(),
        search: z.string().optional(),
        teamId: z.string().optional(),
        environmentId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .use(withTeamAccess("ADMIN"))
    .query(async ({ input, ctx }) => {
      const userIdFromSession = ctx.session?.user?.id;
      const scope = await getAuditScope(userIdFromSession);
      const {
        action,
        userId,
        entityTypes,
        search,
        startDate,
        endDate,
      } = input;
      const maxExportRows = 10_000;

      const conditions: Record<string, unknown>[] = [];
      pushAuditScope(conditions, scope);

      if (action) {
        conditions.push({ action });
      }

      if (userId) {
        conditions.push({ userId });
      }

      if (entityTypes && entityTypes.length > 0) {
        conditions.push({ entityType: { in: entityTypes } });
      }

      if (input.teamId) {
        conditions.push({ teamId: input.teamId });
      }

      if (input.environmentId) {
        conditions.push({ environmentId: input.environmentId });
      }

      if (startDate || endDate) {
        const createdAt: Record<string, Date> = {};
        if (startDate) {
          createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          createdAt.lte = new Date(endDate);
        }
        conditions.push({ createdAt });
      }

      if (search) {
        conditions.push({
          OR: [
            { action: { contains: search, mode: "insensitive" } },
            { entityType: { contains: search, mode: "insensitive" } },
            { entityId: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      const where = conditions.length > 0 ? { AND: conditions } : {};

      const [items, totalCount] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: maxExportRows,
        }),
        prisma.auditLog.count({ where }),
      ]);

      return { items, totalCount };
    }),
});
