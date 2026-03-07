import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { authenticateScim } from "../auth";

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

export async function GET(req: NextRequest) {
  if (!(await authenticateScim(req))) {
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Unauthorized",
        status: "401",
      },
      { status: 401 },
    );
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
    if (nameMatch) where.name = nameMatch[1];
  }

  const [teams, total] = await Promise.all([
    prisma.team.findMany({
      where,
      skip: startIndex - 1,
      take: count,
      include: {
        members: {
          include: {
            user: { select: { email: true } },
          },
        },
      },
    }),
    prisma.team.count({ where }),
  ]);

  return NextResponse.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: count,
    Resources: teams.map(toScimGroup),
  });
}

export async function POST(req: NextRequest) {
  if (!(await authenticateScim(req))) {
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Unauthorized",
        status: "401",
      },
      { status: 401 },
    );
  }

  try {
    const body = await req.json();
    const displayName = body.displayName;
    if (!displayName || typeof displayName !== "string") {
      return NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail: "displayName is required",
          status: "400",
        },
        { status: 400 },
      );
    }

    // Check if a team with this name already exists — adopt it
    const existing = await prisma.team.findFirst({
      where: { name: displayName },
      include: { members: { include: { user: { select: { email: true } } } } },
    });

    if (existing) {
      return NextResponse.json(toScimGroup(existing), { status: 200 });
    }

    const team = await prisma.team.create({
      data: { name: displayName },
      include: { members: { include: { user: { select: { email: true } } } } },
    });

    await writeAuditLog({
      userId: null,
      action: "scim.group_created",
      entityType: "Team",
      entityId: team.id,
      metadata: { displayName },
    });

    return NextResponse.json(toScimGroup(team), { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create group";
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: message,
        status: "400",
      },
      { status: 400 },
    );
  }
}
