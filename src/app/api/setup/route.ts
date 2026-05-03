import { NextResponse } from "next/server";
import { isSetupRequired, completeSetup } from "@/server/services/setup";
import { checkIpRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { errorLog } from "@/lib/logger";
import { sendTelemetryHeartbeat } from "@/server/services/telemetry-sender";

export async function GET(request: Request) {
  const rateLimited = await checkIpRateLimit(request, "setup", 5);
  if (rateLimited) return rateLimited;

  try {
    const setupRequired = await isSetupRequired();
    return NextResponse.json({ setupRequired });
  } catch {
    return NextResponse.json({ setupRequired: false });
  }
}

export async function POST(request: Request) {
  const rateLimited = await checkIpRateLimit(request, "setup", 5);
  if (rateLimited) return rateLimited;

  try {
    // CSRF protection: verify origin matches host
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host) {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { error: "Origin mismatch" },
          { status: 403 }
        );
      }
    }

    const setupRequired = await isSetupRequired();
    if (!setupRequired) {
      return NextResponse.json(
        { error: "Setup has already been completed." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { email, name, password, teamName, telemetryChoice } = body;

    if (!email || !name || !password || !teamName || !telemetryChoice) {
      return NextResponse.json(
        { error: "All fields are required." },
        { status: 400 }
      );
    }

    if (!["yes", "no"].includes(telemetryChoice)) {
      return NextResponse.json(
        { error: "telemetryChoice must be 'yes' or 'no'." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    await completeSetup({ email, name, password, teamName, telemetryChoice });

    if (telemetryChoice === "yes") {
      void Promise.resolve(sendTelemetryHeartbeat()).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    errorLog("setup", "Setup error", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during setup." },
      { status: 500 }
    );
  }
}
