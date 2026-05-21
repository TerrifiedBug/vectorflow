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

    // SCIM 2.0 request-shape validation — return 400 (`invalidValue`)
    // for malformed payloads rather than letting `scimCreateUser`'s
    // downstream property accesses turn missing fields into a server
    // 500. The IdP would otherwise retry on 500 and trip the
    // `scim_sync_failed` alert path on every retry.
    const userName =
      typeof body?.userName === "string" ? body.userName : undefined;
    const primaryEmail =
      Array.isArray(body?.emails) && typeof body.emails[0]?.value === "string"
        ? body.emails[0].value
        : undefined;
    if (!userName && !primaryEmail) {
      return NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail: "userName or emails[0].value is required",
          status: "400",
          scimType: "invalidValue",
        },
        { status: 400 },
      );
    }

    const { user, adopted } = await scimCreateUser(auth.organizationId, body);
    // Return 200 for adopted (existing) users, 201 for newly created
    return NextResponse.json(user, { status: adopted ? 200 : 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    // Local-account / cross-org-adoption conflict — return 409 per SCIM 2.0
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

    // SyntaxError from `await req.json()` on a malformed body is a
    // request-shape problem — 400, not 500. Same for TypeError /
    // RangeError that came out of a malformed input field deeper in
    // the create path (e.g. `email.split` failing because email was
    // not a string at all). 500 stays for genuinely-unexpected
    // throws (Prisma down, bcrypt failure, etc.) so an operator
    // alert path is still wired to the right class of error.
    if (
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail: message,
          status: "400",
          scimType: "invalidValue",
        },
        { status: 400 },
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
