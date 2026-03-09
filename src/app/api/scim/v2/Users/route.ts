import { NextRequest, NextResponse } from "next/server";
import { authenticateScim } from "../auth";
import { scimListUsers, scimCreateUser, fireScimSyncFailedAlert } from "@/server/services/scim";

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
    const { user, adopted } = await scimCreateUser(body);
    // Return 200 for adopted (existing) users, 201 for newly created
    return NextResponse.json(user, { status: adopted ? 200 : 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create user";
    void fireScimSyncFailedAlert(message);
    // RFC 7644 §3.3: uniqueness conflicts use 409
    const isConflict = error instanceof Error && (error as Error & { scimConflict?: boolean }).scimConflict === true;
    const status = isConflict ? 409 : 400;
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: message,
        status: String(status),
      },
      { status },
    );
  }
}
