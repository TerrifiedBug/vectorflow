import { NextResponse } from "next/server";

function scimNotFound() {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "Endpoint not found",
      status: "404",
    },
    { status: 404 },
  );
}

export async function GET() {
  return scimNotFound();
}
export async function POST() {
  return scimNotFound();
}
export async function PUT() {
  return scimNotFound();
}
export async function PATCH() {
  return scimNotFound();
}
export async function DELETE() {
  return scimNotFound();
}
