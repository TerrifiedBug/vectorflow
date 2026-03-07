import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { authenticateScim } from "../../auth";
import {
  loadGroupMappings,
  getMappingsForGroup,
  applyMappedMemberships,
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
  const group = await prisma.scimGroup.findUnique({ where: { id } });

  if (!group) {
    return scimError("Group not found", 404);
  }

  return NextResponse.json(toScimGroupResponse(group));
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
    const allMappings = await loadGroupMappings();
    let groupMappings = getMappingsForGroup(allMappings, group.displayName);

    await prisma.$transaction(async (tx) => {
      for (const op of operations) {
        const operation = op.op?.toLowerCase();

        if (operation === "replace" && op.path === "displayName" && typeof op.value === "string") {
          await tx.scimGroup.update({
            where: { id },
            data: { displayName: op.value },
          });
          // Re-resolve mappings so subsequent member ops use the new name
          groupMappings = getMappingsForGroup(allMappings, op.value);
        }

        if (operation === "add" && op.path === "members") {
          const members = Array.isArray(op.value) ? op.value : [op.value];
          for (const member of members) {
            const userId = member.value;
            if (typeof userId !== "string") continue;
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) continue;
            await applyMappedMemberships(tx, userId, groupMappings);
          }
        }

        // Member remove is intentionally a no-op. Without tracking which
        // group granted each TeamMember, removing here would silently
        // revoke access still legitimately granted by other groups, OIDC,
        // or manual assignment. Memberships reconcile on next OIDC login.
      }
    });

    await writeAuditLog({
      userId: null,
      action: "scim.group_patched",
      entityType: "ScimGroup",
      entityId: id,
      metadata: {
        displayName: group.displayName,
        mappedTeams: groupMappings.map((m) => m.teamId),
        operations: operations.map((o: { op: string; path?: string }) => ({ op: o.op, path: o.path })),
      },
    });

    const updated = await prisma.scimGroup.findUnique({ where: { id } });
    if (!updated) {
      return scimError("Group not found", 404);
    }

    return NextResponse.json(toScimGroupResponse(updated));
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
    const allMappings = await loadGroupMappings();
    let groupMappings = getMappingsForGroup(allMappings, group.displayName);

    await prisma.$transaction(async (tx) => {
      if (body.displayName && typeof body.displayName === "string") {
        await tx.scimGroup.update({
          where: { id },
          data: { displayName: body.displayName },
        });
        // Re-resolve mappings so member sync uses the new name
        groupMappings = getMappingsForGroup(allMappings, body.displayName);
      }

      // Additive-only member sync through mappings. We cannot remove members
      // here because we don't track which group granted each membership —
      // removing would silently deprovision users from other groups, OIDC, or
      // manual assignment that share the same mapped team.
      if (body.members && Array.isArray(body.members) && groupMappings.length > 0) {
        const memberUserIds = body.members
          .map((m: { value?: unknown }) => m.value)
          .filter((v: unknown): v is string => typeof v === "string");

        for (const userId of memberUserIds) {
          const user = await tx.user.findUnique({ where: { id: userId } });
          if (!user) continue;
          await applyMappedMemberships(tx, userId, groupMappings);
        }
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
        mappedTeams: groupMappings.map((m) => m.teamId),
      },
    });

    const updated = await prisma.scimGroup.findUnique({ where: { id } });
    if (!updated) {
      return scimError("Group not found", 404);
    }

    return NextResponse.json(toScimGroupResponse(updated));
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
  const group = await prisma.scimGroup.findUnique({ where: { id } });
  if (!group) {
    return scimError("Group not found", 404);
  }

  // Don't cascade to TeamMembers — we cannot determine which members were
  // granted by this specific group vs other groups, OIDC login, or manual
  // assignment. Memberships are corrected on next OIDC login or SCIM sync.
  await prisma.scimGroup.delete({ where: { id } });

  await writeAuditLog({
    userId: null,
    action: "scim.group_deleted",
    entityType: "ScimGroup",
    entityId: id,
    metadata: { displayName: group.displayName },
  });

  return new NextResponse(null, { status: 204 });
}
