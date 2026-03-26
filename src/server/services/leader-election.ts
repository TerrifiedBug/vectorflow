import type Redis from "ioredis";
import { randomUUID } from "crypto";
import { getRedis } from "@/lib/redis";

// ─── Lua Scripts ────────────────────────────────────────────────────────────

/** Renew leadership: extend TTL only if we still own the key. */
const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
else
  return 0
end
`;

/** Release leadership: delete only if we still own the key. */
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

// ─── Leader Election ────────────────────────────────────────────────────────

export interface LeaderElectionOptions {
  redis: Redis | null;
  instanceId?: string;
  ttlSeconds?: number;
  renewIntervalMs?: number;
}

export class LeaderElection {
  readonly instanceId: string;

  private readonly redis: Redis | null;
  private readonly leaderKey = "vectorflow:leader";
  private readonly ttlSeconds: number;
  readonly renewIntervalMs: number;

  private _isLeader = false;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  constructor(opts: LeaderElectionOptions) {
    this.redis = opts.redis;
    this.instanceId = opts.instanceId ?? randomUUID();
    this.ttlSeconds = opts.ttlSeconds ?? 15;
    this.renewIntervalMs = opts.renewIntervalMs ?? 5000;

    if (!this.redis) {
      this._isLeader = true;
      console.log(
        "[leader-election] No Redis configured — assuming leadership (single-instance mode)",
      );
    }
  }

  /** Current cached leadership state. Synchronous for cheap hot-path checks. */
  isLeader(): boolean {
    return this._isLeader;
  }

  /** Attempt to acquire leadership, then start the renewal loop. */
  async start(): Promise<void> {
    if (!this.redis) return; // already leader in single-instance mode

    await this.tryAcquire();

    this.renewTimer = setInterval(async () => {
      if (this._isLeader) {
        const renewed = await this.renew();
        if (renewed) {
          this.consecutiveFailures = 0;
        } else {
          this.consecutiveFailures++;
          if (
            this.consecutiveFailures >=
            LeaderElection.MAX_CONSECUTIVE_FAILURES
          ) {
            this._isLeader = false;
            this.consecutiveFailures = 0;
            console.log(
              "[leader-election] Lost leadership — another instance is leader",
            );
          }
        }
      } else {
        // Not leader — try to acquire on each tick
        await this.tryAcquire();
      }
    }, this.renewIntervalMs);
  }

  /** Stop the renewal loop and release leadership if held. */
  async stop(): Promise<void> {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }

    if (this._isLeader && this.redis) {
      await this.release();
      this._isLeader = false;
      console.log(
        `[leader-election] Released leadership (shutdown)`,
      );
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async tryAcquire(): Promise<boolean> {
    if (!this.redis) return true;

    try {
      const result = await this.redis.set(
        this.leaderKey,
        this.instanceId,
        "EX",
        this.ttlSeconds,
        "NX",
      );

      if (result === "OK") {
        this._isLeader = true;
        this.consecutiveFailures = 0;
        console.log(
          `[leader-election] Acquired leadership (instance=${this.instanceId})`,
        );
        return true;
      }

      return false;
    } catch (err) {
      console.error(
        `[leader-election] Error acquiring leadership: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async renew(): Promise<boolean> {
    if (!this.redis) return true;

    try {
      const result = await this.redis.eval(
        RENEW_SCRIPT,
        1,
        this.leaderKey,
        this.instanceId,
        String(this.ttlSeconds),
      );

      if (result === 1) {
        console.log("[leader-election] Renewed leadership");
        return true;
      }

      return false;
    } catch (err) {
      console.error(
        `[leader-election] Error renewing leadership: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async release(): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.eval(
        RELEASE_SCRIPT,
        1,
        this.leaderKey,
        this.instanceId,
      );
    } catch (err) {
      console.error(
        `[leader-election] Error releasing leadership: ${(err as Error).message}`,
      );
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

const globalForLeader = globalThis as unknown as {
  leaderElection: LeaderElection | undefined;
};

export const leaderElection: LeaderElection =
  globalForLeader.leaderElection ??
  (globalForLeader.leaderElection = new LeaderElection({
    redis: getRedis(),
  }));

/** Convenience — delegates to the singleton. */
export function isLeader(): boolean {
  return leaderElection.isLeader();
}

/** Starts leadership acquisition on the singleton instance. */
export async function initLeaderElection(): Promise<void> {
  await leaderElection.start();
}
