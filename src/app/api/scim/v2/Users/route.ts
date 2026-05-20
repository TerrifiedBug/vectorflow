import { NextRequest, NextResponse } from "next/server";
import { authenticateScim } from "../auth";
import { scimListUsers, scimCreateUser, fireScimSyncFailedAlert } from "@/server/services/scim";

function unauthorized() {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "Unauthorized",
      status: "401",
    },
    { status: 401 },
  );
}

export async function GET(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return unauthorized();

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

  const result = await scimListUsers(auth.organizationId, filter, startIndex, count);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return unauthorized();

  try {
    const body = await req.json();
    const { user, adopted } = await scimCreateUser(auth.organizationId, body);
    // Return 200 for adopted (existing) users, 201 for newly created
    return NextResponse.json(user, { status: adopted ? 200 : 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    // Local-account conflict — return 409 per SCIM 2.0
    if ((error as { scimConflict?: boolean }).scimConflict) {
      return NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail: message,
          status: "409",
          scimType: "uniqueness",
        },
        { status: 409 },
      );
    }

    await fireScimSyncFailedAlert(message);
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: message,
        status: "500",
      },
      { status: 500 },
    );
  }
}
