import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fireScimSyncFailedAlert, writeScimAuditLog } from "@/server/services/scim";
import { debugLog } from "@/lib/logger";
import { authenticateScim } from "../../auth";
import {
  reconcileUserTeamMemberships,
  getScimGroupNamesForUser,
} from "@/server/services/group-mappings";

function scimError(detail: string, status: number) {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail,
      status: String(status),
    },
    { status },
  );
}

function toScimGroupResponse(
  group: { id: string; displayName: string; externalId?: string | null },
  members: Array<{ value: string; display?: string }> = [],
) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: group.id,
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.displayName,
    members,
  };
}

/**
 * Verify the SCIM caller's organisation owns this group. Returns the
 * group on success and null when the group either doesn't exist or
 * belongs to a peer org — callers MUST 404 (never reveal cross-tenant
 * existence).
 */
async function findOrgGroup(organizationId: string, id: string) {
  return prisma.scimGroup.findFirst({
    where: { id, organizationId },
  });
}

/**
 * Scoped find that includes members. Same org isolation rules as
 * `findOrgGroup` above.
 */
async function findOrgGroupWithMembers(organizationId: string, id: string) {
  return prisma.scimGroup.findFirst({
    where: { id, organizationId },
    include: {
      members: { select: { userId: true, user: { select: { email: true } } } },
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  const { id } = await params;
  const group = await findOrgGroupWithMembers(auth.organizationId, id);
  if (!group) return scimError("Group not found", 404);

  return NextResponse.json(
    toScimGroupResponse(
      group,
      group.members.map((m) => ({ value: m.userId, display: m.user.email })),
    ),
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  const { id } = await params;
  const group = await findOrgGroup(auth.organizationId, id);
  if (!group) return scimError("Group not found", 404);

  const orgId = auth.organizationId;

  try {
    const body = await req.json();
    const operations = body.Operations ?? body.operations ?? [];
    debugLog("scim", `PATCH /Groups/${id}`, {
      displayName: group.displayName,
      operations: operations.map(
        (o: { op: string; path?: string; value?: unknown }) => ({
          op: o.op,
          path: o.path,
          valueType: typeof o.value,
          valueLength: Array.isArray(o.value) ? o.value.length : undefined,
        }),
      ),
    });

    await prisma.$transaction(async (tx) => {
      for (const op of operations) {
        const operation = op.op?.toLowerCase();

        // displayName rename
        if (
          operation === "replace" &&
          op.path === "displayName" &&
          typeof op.value === "string"
        ) {
          await tx.scimGroup.update({
            where: { id },
            data: { displayName: op.value },
          });
          const groupMembers = await tx.scimGroupMember.findMany({
            where: { scimGroupId: id },
          });
          for (const gm of groupMembers) {
            const groupNames = await getScimGroupNamesForUser(tx, gm.userId, orgId);
            await reconcileUserTeamMemberships(tx, gm.userId, groupNames, orgId);
          }
        }

        // Add members — cross-tenant guard: only resolve users who are
        // already members of this SCIM caller's org.
        if (operation === "add" && op.path === "members") {
          const members = Array.isArray(op.value) ? op.value : [op.value];
          for (const member of members) {
            const userId = member.value;
            if (typeof userId !== "string") continue;
            const user = await tx.user.findFirst({
              where: {
                id: userId,
                orgMemberships: { some: { organizationId: orgId } },
              },
            });
            if (!user) continue;

            await tx.scimGroupMember.upsert({
              where: { scimGroupId_userId: { scimGroupId: id, userId } },
              create: { scimGroupId: id, userId },
              update: {},
            });

            const groupNames = await getScimGroupNamesForUser(tx, userId, orgId);
            await reconcileUserTeamMemberships(tx, userId, groupNames, orgId);
          }
        }

        // Remove members — handle both RFC 7644 forms:
        // 1. Filter: { op: "remove", path: "members[value eq \"userId\"]" }
        // 2. Array:  { op: "remove", path: "members", value: [{ value: "userId" }] }
        if (operation === "remove") {
          const filterMatch = typeof op.path === "string"
            ? op.path.match(/^members\[value eq "([^"]+)"\]$/i)
            : null;

          if (filterMatch) {
            const userId = filterMatch[1];
            await tx.scimGroupMember.deleteMany({
              where: { scimGroupId: id, userId },
            });
            const groupNames = await getScimGroupNamesForUser(tx, userId, orgId);
            await reconcileUserTeamMemberships(tx, userId, groupNames, orgId);
          } else if (op.path === "members") {
            const members = Array.isArray(op.value) ? op.value : [op.value];
            for (const member of members) {
              const userId = member.value;
              if (typeof userId !== "string") continue;

              await tx.scimGroupMember.deleteMany({
                where: { scimGroupId: id, userId },
              });

              const groupNames = await getScimGroupNamesForUser(tx, userId, orgId);
              await reconcileUserTeamMemberships(tx, userId, groupNames, orgId);
            }
          }
        }
      }
    });

    await writeScimAuditLog({
      action: "scim.group_patched",
      entityType: "ScimGroup",
      entityId: id,
      metadata: {
        displayName: group.displayName,
        organizationId: orgId,
        operations: operations.map((o: { op: string; path?: string }) => ({
          op: o.op,
          path: o.path,
        })),
      },
      status: "success",
    });

    const updated = await findOrgGroupWithMembers(orgId, id);
    if (!updated) return scimError("Group not found", 404);

    return NextResponse.json(
      toScimGroupResponse(
        updated,
        updated.members.map((m) => ({
          value: m.userId,
          display: m.user.email,
        })),
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to patch group";
    await writeScimAuditLog({
      action: "scim.group_patched",
      entityType: "ScimGroup",
      entityId: id,
      metadata: { displayName: group.displayName, organizationId: orgId },
      status: "failure",
      error,
    });
    void fireScimSyncFailedAlert(message);
    return scimError(message, 400);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  const { id } = await params;
  const group = await findOrgGroup(auth.organizationId, id);
  if (!group) return scimError("Group not found", 404);

  const orgId = auth.organizationId;

  try {
    const body = await req.json();
    const membersProvided = Array.isArray(body.members);
    debugLog("scim", `PUT /Groups/${id}`, {
      displayName: body.displayName,
      membersProvided,
      memberCount: membersProvided ? body.members.length : undefined,
    });

    await prisma.$transaction(async (tx) => {
      // Update displayName if provided
      if (body.displayName && typeof body.displayName === "string") {
        await tx.scimGroup.update({
          where: { id },
          data: { displayName: body.displayName },
        });
      }

      // Full member sync: compute desired set, diff against current.
      // Cross-tenant guard: only consider users who already belong to
      // this SCIM caller's org.
      const desiredUserIds = new Set<string>();
      if (membersProvided) {
        for (const m of body.members) {
          const userId = (m as { value?: unknown }).value;
          if (typeof userId !== "string") continue;
          const user = await tx.user.findFirst({
            where: {
              id: userId,
              orgMemberships: { some: { organizationId: orgId } },
            },
          });
          if (!user) continue;
          desiredUserIds.add(userId);
        }
      }

      const currentMembers = await tx.scimGroupMember.findMany({
        where: { scimGroupId: id },
      });
      const currentUserIds = new Set(currentMembers.map((m) => m.userId));

      // Add missing members
      for (const userId of desiredUserIds) {
        if (!currentUserIds.has(userId)) {
          await tx.scimGroupMember.create({
            data: { scimGroupId: id, userId },
          });
        }
      }

      // Skip member removal when the incoming member list is empty but
      // current members exist. Many SCIM providers (e.g. pocket-id) send
      // intermediate PUTs with members:[] during background sync before
      // re-adding members individually — treating this as "remove all" causes
      // destructive churn (team memberships deleted then re-created).
      const skipRemoval = desiredUserIds.size === 0 && currentMembers.length > 0;
      if (skipRemoval) {
        debugLog("scim", `PUT /Groups/${id}: skipping member removal (empty incoming list with ${currentMembers.length} current members)`);
      }

      if (!skipRemoval) {
        for (const member of currentMembers) {
          if (!desiredUserIds.has(member.userId)) {
            await tx.scimGroupMember.delete({ where: { id: member.id } });
          }
        }
      }

      // Reconcile all affected users (union of current + desired)
      const allAffectedUserIds = new Set([...currentUserIds, ...desiredUserIds]);
      for (const userId of allAffectedUserIds) {
        const groupNames = await getScimGroupNamesForUser(tx, userId, orgId);
        await reconcileUserTeamMemberships(tx, userId, groupNames, orgId);
      }
    });

    await writeScimAuditLog({
      action: "scim.group_updated",
      entityType: "ScimGroup",
      entityId: id,
      metadata: {
        displayName: body.displayName ?? group.displayName,
        memberCount: body.members?.length,
        organizationId: orgId,
      },
      status: "success",
    });

    const updated = await findOrgGroupWithMembers(orgId, id);
    if (!updated) return scimError("Group not found", 404);

    return NextResponse.json(
      toScimGroupResponse(
        updated,
        updated.members.map((m) => ({
          value: m.userId,
          display: m.user.email,
        })),
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update group";
    await writeScimAuditLog({
      action: "scim.group_updated",
      entityType: "ScimGroup",
      entityId: id,
      metadata: { displayName: group.displayName, organizationId: orgId },
      status: "failure",
      error,
    });
    void fireScimSyncFailedAlert(message);
    return scimError(message, 400);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  const { id } = await params;
  const group = await prisma.scimGroup.findFirst({
    where: { id, organizationId: auth.organizationId },
    include: { members: { select: { userId: true } } },
  });
  if (!group) return scimError("Group not found", 404);

  const orgId = auth.organizationId;

  try {
    const affectedUserIds = group.members.map((m) => m.userId);

    await prisma.$transaction(async (tx) => {
      await tx.scimGroup.delete({ where: { id } });
      for (const userId of affectedUserIds) {
        const groupNames = await getScimGroupNamesForUser(tx, userId, orgId);
        await reconcileUserTeamMemberships(tx, userId, groupNames, orgId);
      }
    });

    await writeScimAuditLog({
      action: "scim.group_deleted",
      entityType: "ScimGroup",
      entityId: id,
      metadata: { displayName: group.displayName, organizationId: orgId },
      status: "success",
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete group";
    await writeScimAuditLog({
      action: "scim.group_deleted",
      entityType: "ScimGroup",
      entityId: id,
      metadata: { displayName: group.displayName, organizationId: orgId },
      status: "failure",
      error,
    });
    void fireScimSyncFailedAlert(message);
    return scimError(message, 400);
  }
}
