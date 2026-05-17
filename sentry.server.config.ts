import * as Sentry from "@sentry/nextjs";
import { getLogContext } from "@/lib/log-context";
import { applyLogContextTags, sanitizeSentryEvent } from "@/lib/sentry-sanitize";
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
      // Tag the event with per-request context (org_id, request_id)
      // from the AsyncLocalStorage carrier so events can be sliced
      // per tenant. Without this every event lands in a shared feed.
      applyLogContextTags(event, getLogContext());

      // Denylist sanitization — strip request bodies, sensitive query
      // params, and denylisted headers BEFORE the event leaves the
      // process. Multi-tenant request bodies routinely contain
      // customer secrets we don't want in Sentry's indexes (pipeline
      // YAML, agent enrollment tokens, magic-link redeem tokens).
      return sanitizeSentryEvent(event);
    },
  });
}
