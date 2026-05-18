/**
 * tRPC-flavoured quota gate.
 *
 * Thin wrapper around `withQuotaCheck` that converts `QuotaExceededError`
 * into a `TRPCError` with `code: "PAYMENT_REQUIRED"` (HTTP 402). The
 * original `QuotaExceededError` is attached as the error `cause` so
 * client code can narrow on `err.data?.code === "PAYMENT_REQUIRED"` AND
 * inspect the underlying quota / plan / limit metadata.
 *
 * Service-layer callers (cron jobs, agent route handlers) keep using
 * `withQuotaCheck` directly and translate the error themselves —
 * wrapping the underlying create + post-check + advisory lock in a
 * service-layer helper would obscure the read-after-write semantics the
 * tRPC layer relies on.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@/generated/prisma";
import {
  withQuotaCheck,
  QuotaExceededError,
  type QuotaName,
} from "@/server/services/quotas";

export async function enforceQuota<T>(
  organizationId: string,
  quota: QuotaName,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await withQuotaCheck(organizationId, quota, create);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      throw new TRPCError({
        code: "PAYMENT_REQUIRED",
        message:
          `Plan limit reached: ${err.current}/${err.limit} ${err.quota} on ` +
          `${err.plan} plan. Upgrade to continue.`,
        cause: err,
      });
    }
    throw err;
  }
}

export { QuotaExceededError };
