import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { authenticateScim } from "../auth";
import {
  loadGroupMappings,
  getMappingsForGroup,
  applyMappedMemberships,
} from "@/server/services/group-mappings";

interface ScimGroupResponse {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
}

function toScimGroupResponse(
  group: { id: string; displayName: string },
  members: Array<{ value: string; display?: string }> = [],
): ScimGroupResponse {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: group.id,
    displayName: group.displayName,
    members,
  };
}

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

/**
 * Process members from a SCIM group request through the mapping table.
 */
async function applyGroupMembers(
  groupName: string,
  members: unknown,
): Promise<void> {
  if (!Array.isArray(members) || members.length === 0) return;

  const allMappings = await loadGroupMappings();
  const groupMappings = getMappingsForGroup(allMappings, groupName);
  if (groupMappings.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const member of members) {
      const userId = (member as { value?: unknown }).value;
      if (typeof userId !== "string") continue;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) continue;
      await applyMappedMemberships(tx, userId, groupMappings);
    }
  });
}

export async function GET(req: NextRequest) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? undefined;
  const startIndexRaw = parseInt(url.searchParams.get("startIndex") ?? "1");
  const countRaw = parseInt(url.searchParams.get("count") ?? "100");
  const startIndex =
    Number.isFinite(startIndexRaw) && startIndexRaw >= 1 ? startIndexRaw : 1;
  const count =
    Number.isFinite(countRaw) && countRaw >= 1
      ? Math.min(countRaw, 1000)
      : 100;

  const where: Record<string, unknown> = {};
  if (filter) {
    const nameMatch = filter.match(/displayName\s+eq\s+"(.+?)"/);
    if (nameMatch) where.displayName = nameMatch[1];
  }

  const [groups, total] = await Promise.all([
    prisma.scimGroup.findMany({
      where,
      skip: startIndex - 1,
      take: count,
      orderBy: { createdAt: "asc" },
    }),
    prisma.scimGroup.count({ where }),
  ]);

  return NextResponse.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: count,
    Resources: groups.map((g) => toScimGroupResponse(g)),
  });
}

export async function POST(req: NextRequest) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  try {
    const body = await req.json();
    const displayName = body.displayName;
    if (!displayName || typeof displayName !== "string") {
      return scimError("displayName is required", 400);
    }

    // Check if ScimGroup already exists — adopt it
    const existing = await prisma.scimGroup.findUnique({
      where: { displayName },
    });

    if (existing) {
      let adopted = existing;
      if (body.externalId && body.externalId !== existing.externalId) {
        adopted = await prisma.scimGroup.update({
          where: { id: existing.id },
          data: { externalId: body.externalId },
        });
      }

      await applyGroupMembers(displayName, body.members);

      await writeAuditLog({
        userId: null,
        action: "scim.group_adopted",
        entityType: "ScimGroup",
        entityId: adopted.id,
        metadata: { displayName },
      });

      return NextResponse.json(toScimGroupResponse(adopted), { status: 200 });
    }

    const group = await prisma.scimGroup.create({
      data: {
        displayName,
        externalId: body.externalId ?? null,
      },
    });

    await applyGroupMembers(displayName, body.members);

    await writeAuditLog({
      userId: null,
      action: "scim.group_created",
      entityType: "ScimGroup",
      entityId: group.id,
      metadata: { displayName },
    });

    return NextResponse.json(toScimGroupResponse(group), { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create group";
    return scimError(message, 400);
  }
}
