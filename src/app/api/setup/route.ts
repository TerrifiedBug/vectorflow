import { NextResponse } from "next/server";
import {
  isSetupRequired,
  completeSetup,
  SetupAlreadyCompletedError,
} from "@/server/services/setup";
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

/**
 * Normalise a `Host:` or `Origin:` value to lower-case host (no scheme,
 * no port, no IPv6 brackets) so equality comparison survives the casing
 * and bracket variants legal browsers and proxies emit.
 *
 * The previous string-equality check on raw `origin`/`host`
 * passed an attacker who submitted `EXAMPLE.COM` against `example.com`,
 * passed when `origin` was missing (the `if (origin && host)` branch
 * was skipped entirely), and silently failed open when `new URL(origin)`
 * threw inside the try-block.
 */
function normalizeHostValue(value: string | null | undefined): string | null {
  if (!value) return null;
  // Accept both bare host ("example.com:443") and full URLs ("https://example.com:443").
  let candidate: string;
  if (/^https?:\/\//i.test(value)) {
    try {
      candidate = new URL(value).host;
    } catch {
      return null;
    }
  } else {
    candidate = value.trim();
  }
  // Strip IPv6 brackets first, then the optional :port.
  if (candidate.startsWith("[")) {
    const close = candidate.indexOf("]");
    if (close > 0) {
      const tail = candidate.slice(close + 1);
      // tail = ":443" or ""; ignore.
      candidate = candidate.slice(1, close) + (tail.startsWith(":") ? "" : "");
    }
  } else {
    const colon = candidate.lastIndexOf(":");
    if (colon > 0) candidate = candidate.slice(0, colon);
  }
  return candidate.toLowerCase();
}

export async function POST(request: Request) {
  const rateLimited = await checkIpRateLimit(request, "setup", 5);
  if (rateLimited) return rateLimited;

  try {
    // CSRF protection — REQUIRE Origin and compare normalised hostnames.
    // A missing Origin header is treated as a CSRF failure (the
    // previous implementation passed-through when Origin was absent,
    // which an attacker can produce from a cross-origin form submit
    // depending on browser version).
    const originRaw = request.headers.get("origin");
    const hostRaw = request.headers.get("host");
    const originHost = normalizeHostValue(originRaw);
    const requestHost = normalizeHostValue(hostRaw);
    if (!originHost || !requestHost || originHost !== requestHost) {
      return NextResponse.json(
        { error: "Origin mismatch" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { email, name, password, teamName, telemetryChoice, requireTwoFactor, environmentName } = body;

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

    if (typeof requireTwoFactor !== "boolean") {
      return NextResponse.json(
        { error: "requireTwoFactor must be a boolean." },
        { status: 400 }
      );
    }

    if (typeof environmentName !== "string" || !environmentName.trim() || environmentName.length > 100) {
      return NextResponse.json(
        { error: "environmentName must be a non-empty string (max 100 characters)." },
        { status: 400 }
      );
    }

    try {
      await completeSetup({
        email,
        name,
        password,
        teamName,
        telemetryChoice,
        requireTwoFactor,
        environmentName: environmentName.trim(),
      });
    } catch (err) {
      if (err instanceof SetupAlreadyCompletedError) {
        return NextResponse.json(
          { error: "Setup has already been completed." },
          { status: 400 },
        );
      }
      throw err;
    }

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

export const __test__ = { normalizeHostValue };
