import { NextRequest, NextResponse } from "next/server";
import { authenticateScim } from "../../auth";
import {
  scimGetUser,
  scimUpdateUser,
  scimPatchUser,
  scimDeleteUser,
} from "@/server/services/scim";

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
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;
  const user = await scimGetUser(id);
  if (!user) {
    return scimError("User not found", 404);
  }

  return NextResponse.json(user);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;

  // Verify user exists
  const existing = await scimGetUser(id);
  if (!existing) {
    return scimError("User not found", 404);
  }

  try {
    const body = await req.json();
    const user = await scimUpdateUser(id, body);
    return NextResponse.json(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update user";
    return scimError(message, 400);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;

  // Verify user exists
  const existing = await scimGetUser(id);
  if (!existing) {
    return scimError("User not found", 404);
  }

  try {
    const body = await req.json();
    const operations = body.Operations ?? body.operations ?? [];
    const user = await scimPatchUser(id, operations);
    if (!user) {
      return scimError("User not found", 404);
    }
    return NextResponse.json(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to patch user";
    return scimError(message, 400);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticateScim(req))) {
    return scimError("Unauthorized", 401);
  }

  const { id } = await params;

  // Verify user exists
  const existing = await scimGetUser(id);
  if (!existing) {
    return scimError("User not found", 404);
  }

  try {
    await scimDeleteUser(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete user";
    return scimError(message, 400);
  }
}
