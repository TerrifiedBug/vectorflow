import { NextRequest, NextResponse } from "next/server";
import { authenticateScim } from "../../auth";
import {
  scimGetUser,
  scimUpdateUser,
  scimPatchUser,
  scimDeleteUser,
  fireScimSyncFailedAlert,
} from "@/server/services/scim";
import { runWithOrgContext } from "@/lib/org-context";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  return runWithOrgContext(auth.organizationId, async () => {
    const { id } = await params;
    const user = await scimGetUser(auth.organizationId, id);
    if (!user) {
      return scimError("User not found", 404);
    }

    return NextResponse.json(user);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  return runWithOrgContext(auth.organizationId, async () => {
    const { id } = await params;

    // Verify user exists in this org. Returns 404 (NOT 403) for users in
    // other orgs so the response never reveals existence in a peer org.
    const existing = await scimGetUser(auth.organizationId, id);
    if (!existing) {
      return scimError("User not found", 404);
    }

    try {
      const body = await req.json();
      const user = await scimUpdateUser(auth.organizationId, id, body);
      if (!user) return scimError("User not found", 404);
      return NextResponse.json(user);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update user";
      void fireScimSyncFailedAlert(message);
      return scimError(message, 400);
    }
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  return runWithOrgContext(auth.organizationId, async () => {
    const { id } = await params;

    const existing = await scimGetUser(auth.organizationId, id);
    if (!existing) {
      return scimError("User not found", 404);
    }

    try {
      const body = await req.json();
      const operations = body.Operations ?? body.operations ?? [];
      const user = await scimPatchUser(auth.organizationId, id, operations);
      if (!user) {
        return scimError("User not found", 404);
      }
      return NextResponse.json(user);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to patch user";
      void fireScimSyncFailedAlert(message);
      return scimError(message, 400);
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return scimError("Unauthorized", 401);

  return runWithOrgContext(auth.organizationId, async () => {
    const { id } = await params;

    const existing = await scimGetUser(auth.organizationId, id);
    if (!existing) {
      return scimError("User not found", 404);
    }

    try {
      const result = await scimDeleteUser(auth.organizationId, id);
      if (!result) return scimError("User not found", 404);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete user";
      void fireScimSyncFailedAlert(message);
      return scimError(message, 400);
    }
  });
}
