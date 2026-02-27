import { NextResponse } from "next/server";
import { getOidcStatus } from "@/auth";

export async function GET() {
  const status = await getOidcStatus();
  return NextResponse.json(status);
}
