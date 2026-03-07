import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { authenticateScim } from "../auth";

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
      if (body.externalId && body.externalId !== existing.externalId) {
        await prisma.scimGroup.update({
          where: { id: existing.id },
          data: { externalId: body.externalId },
        });
      }

      await writeAuditLog({
        userId: null,
        action: "scim.group_adopted",
        entityType: "ScimGroup",
        entityId: existing.id,
        metadata: { displayName },
      });

      return NextResponse.json(toScimGroupResponse(existing), { status: 200 });
    }

    const group = await prisma.scimGroup.create({
      data: {
        displayName,
        externalId: body.externalId ?? null,
      },
    });

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
