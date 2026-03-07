import { NextRequest, NextResponse } from "next/server";
import { authenticateScim } from "../auth";
import { scimListUsers, scimCreateUser } from "@/server/services/scim";

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
    // Handle unique constraint violation (duplicate email or externalId)
    if (message.includes("Unique constraint")) {
      let detail = "User already exists";
      if (message.includes("User_email_key"))
        detail = "A user with this email already exists";
      else if (message.includes("User_scimExternalId_key"))
        detail = "A user with this external ID already exists";
      return NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail,
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
