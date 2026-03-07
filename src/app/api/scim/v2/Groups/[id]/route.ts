import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
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
  group: { id: string; displayName: string },
  members: Array<{ value: string; display?: string }> = [],
) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: group.id,
    displayName: group.displayName,
    members,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;
  const group = await prisma.scimGroup.findUnique({
    where: { id },
    include: {
      members: { select: { userId: true, user: { select: { email: true } } } },
    },
  });

  if (!group) {
    return scimError("Group not found", 404);
  }

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
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;
  const group = await prisma.scimGroup.findUnique({ where: { id } });
  if (!group) {
    return scimError("Group not found", 404);
  }

  try {
    const body = await req.json();
    const operations = body.Operations ?? body.operations ?? [];

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
          // Reconcile all users in this group — their mappings may resolve differently
          const groupMembers = await tx.scimGroupMember.findMany({
            where: { scimGroupId: id },
          });
          for (const gm of groupMembers) {
            const groupNames = await getScimGroupNamesForUser(tx, gm.userId);
            await reconcileUserTeamMemberships(tx, gm.userId, groupNames);
          }
        }

        // Add members
        if (operation === "add" && op.path === "members") {
          const members = Array.isArray(op.value) ? op.value : [op.value];
          for (const member of members) {
            const userId = member.value;
            if (typeof userId !== "string") continue;
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) continue;

            await tx.scimGroupMember.upsert({
              where: { scimGroupId_userId: { scimGroupId: id, userId } },
              create: { scimGroupId: id, userId },
              update: {},
            });

            const groupNames = await getScimGroupNamesForUser(tx, userId);
            await reconcileUserTeamMemberships(tx, userId, groupNames);
          }
        }

        // Remove members
        if (operation === "remove" && op.path === "members") {
          const members = Array.isArray(op.value) ? op.value : [op.value];
          for (const member of members) {
            const userId = member.value;
            if (typeof userId !== "string") continue;

            await tx.scimGroupMember.deleteMany({
              where: { scimGroupId: id, userId },
            });

            const groupNames = await getScimGroupNamesForUser(tx, userId);
            await reconcileUserTeamMemberships(tx, userId, groupNames);
          }
        }
      }
    });

    await writeAuditLog({
      userId: null,
      action: "scim.group_patched",
      entityType: "ScimGroup",
      entityId: id,
      metadata: {
        displayName: group.displayName,
        operations: operations.map((o: { op: string; path?: string }) => ({
          op: o.op,
          path: o.path,
        })),
      },
    });

    const updated = await prisma.scimGroup.findUnique({
      where: { id },
      include: {
        members: {
          select: { userId: true, user: { select: { email: true } } },
        },
      },
    });
    if (!updated) {
      return scimError("Group not found", 404);
    }

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
    return scimError(message, 400);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;
  const group = await prisma.scimGroup.findUnique({ where: { id } });
  if (!group) {
    return scimError("Group not found", 404);
  }

  try {
    const body = await req.json();

    await prisma.$transaction(async (tx) => {
      // Update displayName if provided
      if (body.displayName && typeof body.displayName === "string") {
        await tx.scimGroup.update({
          where: { id },
          data: { displayName: body.displayName },
        });
      }

      // Full member sync: compute desired set, diff against current
      const desiredUserIds = new Set<string>();
      if (body.members && Array.isArray(body.members)) {
        for (const m of body.members) {
          const userId = (m as { value?: unknown }).value;
          if (typeof userId !== "string") continue;
          const user = await tx.user.findUnique({ where: { id: userId } });
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

      // Remove absent members
      for (const member of currentMembers) {
        if (!desiredUserIds.has(member.userId)) {
          await tx.scimGroupMember.delete({ where: { id: member.id } });
        }
      }

      // Reconcile all affected users (union of current + desired)
      const allAffectedUserIds = new Set([...currentUserIds, ...desiredUserIds]);
      for (const userId of allAffectedUserIds) {
        const groupNames = await getScimGroupNamesForUser(tx, userId);
        await reconcileUserTeamMemberships(tx, userId, groupNames);
      }
    });

    await writeAuditLog({
      userId: null,
      action: "scim.group_updated",
      entityType: "ScimGroup",
      entityId: id,
      metadata: {
        displayName: body.displayName ?? group.displayName,
        memberCount: body.members?.length,
      },
    });

    const updated = await prisma.scimGroup.findUnique({
      where: { id },
      include: {
        members: {
          select: { userId: true, user: { select: { email: true } } },
        },
      },
    });
    if (!updated) {
      return scimError("Group not found", 404);
    }

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
    return scimError(message, 400);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;
  const group = await prisma.scimGroup.findUnique({
    where: { id },
    include: { members: { select: { userId: true } } },
  });
  if (!group) {
    return scimError("Group not found", 404);
  }

  // Collect affected user IDs before deletion
  const affectedUserIds = group.members.map((m) => m.userId);

  // Delete the group — ScimGroupMembers cascade via onDelete: Cascade
  await prisma.scimGroup.delete({ where: { id } });

  // Reconcile all users who were in this group
  await prisma.$transaction(async (tx) => {
    for (const userId of affectedUserIds) {
      const groupNames = await getScimGroupNamesForUser(tx, userId);
      await reconcileUserTeamMemberships(tx, userId, groupNames);
    }
  });

  await writeAuditLog({
    userId: null,
    action: "scim.group_deleted",
    entityType: "ScimGroup",
    entityId: id,
    metadata: { displayName: group.displayName },
  });

  return new NextResponse(null, { status: 204 });
}
