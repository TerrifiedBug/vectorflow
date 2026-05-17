/**
 * Scheduled garbage-collection for one-shot auth challenges
 * (plan §16b OSS items 8 + 9).
 *
 * Two sources of orphan rows:
 *
 *   1. `WebAuthnChallenge` — created by `startRegistration` /
 *      `startAuthentication`. Successful flows delete the row in the
 *      same transaction as the assertion verification; rows left
 *      behind are from abandoned UI flows or floods of pre-auth
 *      requests. TTL is 5 minutes.
 *   2. `MagicLinkToken` — emitted to the user's email; the redemption
 *      handler marks the row consumed. Expired-but-unredeemed tokens
 *      pile up at the rate of the magic-link click-through gap.
 *
 * The single cron task sweeps both every minute. Skipping a sweep is
 * harmless (the next pass catches up); the only real failure mode is
 * the DB growing if the scheduler is disabled long-term. The job runs
 * on the leader instance only because the work is identical across
 * instances and one global sweep is sufficient.
 */

import cron, { type ScheduledTask } from "node-cron";

import { errorLog, infoLog } from "@/lib/logger";
import { gcExpiredChallenges } from "@/server/services/webauthn";

const SWEEP_CRON = process.env.VF_AUTH_GC_CRON ?? "* * * * *"; // every minute

let task: ScheduledTask | null = null;

/**
 * Idempotent. Called from `instrumentation.node.ts` inside the
 * `startSingletonServices` block so only the leader runs the sweep.
 */
export function initAuthChallengeGc(): void {
  if (task) return;

  task = cron.schedule(SWEEP_CRON, async () => {
    try {
      const challengesRemoved = await gcExpiredChallenges();
      const magicLinksRemoved = await gcExpiredMagicLinkTokens();
      if (challengesRemoved > 0 || magicLinksRemoved > 0) {
        infoLog(
          "auth-challenge-gc",
          `swept ${challengesRemoved} WebAuthnChallenge + ${magicLinksRemoved} MagicLinkToken rows`,
        );
      }
    } catch (err) {
      errorLog("auth-challenge-gc", "sweep failed", err);
    }
  });
}

/** Test-only stop hook so vitest can tear down between cases. */
export function _stopAuthChallengeGcForTests(): void {
  task?.stop();
  task = null;
}

/**
 * Delete `MagicLinkToken` rows where `expiresAt` has passed OR
 * `consumedAt` is set (redeemed tokens carry no further use). Lazily
 * imported so a deployment that doesn't ship the magic-link service
 * (e.g. an older Prisma client mid-migration) does not crash the
 * sweeper boot path.
 */
async function gcExpiredMagicLinkTokens(): Promise<number> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const result = await prisma.magicLinkToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { consumedAt: { not: null } },
        ],
      },
    });
    return result.count;
  } catch (err) {
    errorLog("auth-challenge-gc", "magic-link sweep failed", err);
    return 0;
  }
}
