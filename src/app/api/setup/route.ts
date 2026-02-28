import { NextResponse } from "next/server";
import { isSetupRequired, completeSetup } from "@/server/services/setup";

export async function GET() {
  try {
    const setupRequired = await isSetupRequired();
    return NextResponse.json({ setupRequired });
  } catch {
    return NextResponse.json({ setupRequired: false });
  }
}

export async function POST(request: Request) {
  try {
    const setupRequired = await isSetupRequired();
    if (!setupRequired) {
      return NextResponse.json(
        { error: "Setup has already been completed." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { email, name, password, teamName } = body;

    if (!email || !name || !password || !teamName) {
      return NextResponse.json(
        { error: "All fields are required." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    await completeSetup({ email, name, password, teamName });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during setup." },
      { status: 500 }
    );
  }
}
