import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/server/services/crypto";
import { scimListUsers, scimCreateUser } from "@/server/services/scim";

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

  const result = await scimListUsers(filter, startIndex, count);
  return NextResponse.json(result);
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
    const user = await scimCreateUser(body);
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create user";
    // Handle unique constraint violation (duplicate email)
    if (message.includes("Unique constraint")) {
      return NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail: "User already exists",
          status: "409",
          scimType: "uniqueness",
        },
        { status: 409 },
      );
    }
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
