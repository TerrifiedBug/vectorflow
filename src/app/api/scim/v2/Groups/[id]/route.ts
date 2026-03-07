import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { authenticateScim } from "../../auth";
import { resolveScimRole } from "@/server/services/scim";

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

interface ScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
}

function toScimGroup(team: {
  id: string;
  name: string;
  members: Array<{ userId: string; user: { email: string } }>;
}): ScimGroup {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: team.id,
    displayName: team.name,
    members: team.members.map((m) => ({
      value: m.userId,
      display: m.user.email,
    })),
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
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: { select: { email: true } },
        },
      },
    },
  });

  if (!team) {
    return scimError("Group not found", 404);
  }

  return NextResponse.json(toScimGroup(team));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;

  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) {
    return scimError("Group not found", 404);
  }

  try {
    const body = await req.json();
    const operations = body.Operations ?? body.operations ?? [];

    await prisma.$transaction(async (tx) => {
      for (const op of operations) {
        const operation = op.op?.toLowerCase();

        if (operation === "add" && op.path === "members") {
          // Add members to the group
          const members = Array.isArray(op.value) ? op.value : [op.value];
          for (const member of members) {
            const userId = member.value;
            if (typeof userId !== "string") continue;
            // Check if the user exists
            const user = await tx.user.findUnique({
              where: { id: userId },
            });
            if (!user) continue;

            // Check if already a member
            const existing = await tx.teamMember.findUnique({
              where: { userId_teamId: { userId, teamId: id } },
            });
            if (!existing) {
              await tx.teamMember.create({
                data: {
                  userId,
                  teamId: id,
                  role: await resolveScimRole(id),
                },
              });
            }
          }
        }

        if (operation === "remove" && op.path) {
          // Parse path like 'members[value eq "userId"]'
          const memberMatch = (op.path as string).match(
            /^members\[value eq "([^"]+)"\]$/,
          );
          if (memberMatch) {
            const userId = memberMatch[1];
            await tx.teamMember.deleteMany({
              where: { userId, teamId: id },
            });
          }

          // Handle value-array form: { op: "remove", path: "members", value: [{ value: "userId" }, ...] }
          if (op.path === "members" && Array.isArray(op.value)) {
            for (const member of op.value as Array<{ value?: unknown }>) {
              if (typeof member.value === "string") {
                await tx.teamMember.deleteMany({
                  where: { userId: member.value, teamId: id },
                });
              }
            }
          }
        }

        if (operation === "replace" && op.path === "displayName" && typeof op.value === "string") {
          await tx.team.update({
            where: { id },
            data: { name: op.value },
          });
        }
      }
    });

    await writeAuditLog({
      userId: null,
      action: "scim.group_patched",
      entityType: "Team",
      entityId: id,
      metadata: { operations: operations.map((o: { op: string; path?: string }) => ({ op: o.op, path: o.path })) },
    });

    // Return the updated group
    const updated = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { email: true } },
          },
        },
      },
    });

    if (!updated) {
      return scimError("Group not found", 404);
    }

    return NextResponse.json(toScimGroup(updated));
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

  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) {
    return scimError("Group not found", 404);
  }

  try {
    const body = await req.json();

    await prisma.$transaction(async (tx) => {
      // Update team name if provided
      if (body.displayName && typeof body.displayName === "string") {
        await tx.team.update({
          where: { id },
          data: { name: body.displayName },
        });
      }

      // Sync members: replace all memberships with the provided list
      if (body.members && Array.isArray(body.members)) {
        // Remove all existing memberships
        await tx.teamMember.deleteMany({ where: { teamId: id } });

        // Add new memberships
        for (const member of body.members) {
          const userId = member.value;
          if (typeof userId !== "string") continue;
          const user = await tx.user.findUnique({
            where: { id: userId },
          });
          if (user) {
            await tx.teamMember.create({
              data: {
                userId,
                teamId: id,
                role: await resolveScimRole(id),
              },
            });
          }
        }
      }
    });

    await writeAuditLog({
      userId: null,
      action: "scim.group_updated",
      entityType: "Team",
      entityId: id,
      metadata: { displayName: body.displayName, memberCount: body.members?.length },
    });

    const updated = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { email: true } },
          },
        },
      },
    });

    if (!updated) {
      return scimError("Group not found", 404);
    }

    return NextResponse.json(toScimGroup(updated));
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

  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) {
    return scimError("Group not found", 404);
  }

  // Remove all memberships but keep the team (soft approach — avoids
  // cascading deletes of environments, pipelines, etc.)
  await prisma.teamMember.deleteMany({ where: { teamId: id } });

  await writeAuditLog({
    userId: null,
    action: "scim.group_deleted",
    entityType: "Team",
    entityId: id,
    metadata: { displayName: team.name },
  });

  return new NextResponse(null, { status: 204 });
}
