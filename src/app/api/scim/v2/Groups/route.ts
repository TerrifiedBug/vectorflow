import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/server/services/crypto";

async function authenticateScim(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice(7);
  const settings = await prisma.systemSettings.findFirst();
  if (!settings?.scimEnabled || !settings?.scimBearerToken) return false;

  try {
    const storedToken = decrypt(settings.scimBearerToken);
    return token === storedToken;
  } catch {
    return false;
  }
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
  const startIndex = parseInt(url.searchParams.get("startIndex") ?? "1");
  const count = parseInt(url.searchParams.get("count") ?? "100");

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
