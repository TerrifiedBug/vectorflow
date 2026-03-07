import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateScim } from "../../auth";

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

    for (const op of operations) {
      const operation = op.op?.toLowerCase();

      if (operation === "add" && op.path === "members") {
        // Add members to the group
        const members = Array.isArray(op.value) ? op.value : [op.value];
        for (const member of members) {
          const userId = member.value;
          if (typeof userId !== "string") continue;
          // Check if the user exists
          const user = await prisma.user.findUnique({
            where: { id: userId },
          });
          if (!user) continue;

          // Check if already a member
          const existing = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId, teamId: id } },
          });
          if (!existing) {
            await prisma.teamMember.create({
              data: {
                userId,
                teamId: id,
                role: "VIEWER", // Default role for SCIM-provisioned members
              },
            });
          }
        }
      }

      if (operation === "remove" && op.path) {
        // Parse path like 'members[value eq "userId"]'
        const memberMatch = (op.path as string).match(
          /members\[value\s+eq\s+"(.+?)"\]/,
        );
        if (memberMatch) {
          const userId = memberMatch[1];
          await prisma.teamMember.deleteMany({
            where: { userId, teamId: id },
          });
        }
      }

      if (operation === "replace" && op.path === "displayName" && typeof op.value === "string") {
        await prisma.team.update({
          where: { id },
          data: { name: op.value },
        });
      }
    }

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
                role: "VIEWER",
              },
            });
          }
        }
      }
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
