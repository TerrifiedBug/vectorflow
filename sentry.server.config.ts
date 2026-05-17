import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "@/lib/sentry-sanitize";

const dsn = process.env.SENTRY_DSN;

/** TRPCError codes that represent expected client errors — not worth reporting. */
const EXPECTED_TRPC_CODES = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"]);

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    beforeSend(event) {
      const exception = event.exception?.values?.[0];
      const errorType = exception?.type ?? "";
      const errorValue = exception?.value ?? "";

      // Filter out expected TRPCErrors
      if (
        errorType === "TRPCError" &&
        EXPECTED_TRPC_CODES.has(errorValue)
      ) {
        return null;
      }

      // Also check the message for TRPCError patterns (some serializations differ)
      if (errorType === "TRPCError") {
        for (const code of EXPECTED_TRPC_CODES) {
          if (errorValue.includes(code)) {
            return null;
          }
        }
      }

      // Plan §11 denylist sanitization — strip request bodies,
      // sensitive query params, and denylisted headers BEFORE the
      // event leaves the process. Multi-tenant SaaS request bodies
      // routinely contain customer secrets we don't want in Sentry's
      // indexes (pipeline YAML, agent enrollment tokens, magic-link
      // redeem tokens).
      return sanitizeSentryEvent(event);
    },
  });
}
