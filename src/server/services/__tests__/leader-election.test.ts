import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  getRedis: vi.fn(() => null),
}));

import { LeaderElection } from "@/server/services/leader-election";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockRedis() {
  return {
    set: vi.fn(),
    eval: vi.fn(),
    del: vi.fn(),
  } as unknown as import("ioredis").default;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LeaderElection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── No Redis fallback ───────────────────────────────────────────────────

  describe("no Redis fallback", () => {
    it("returns true for isLeader when redis is null", () => {
      const le = new LeaderElection({ redis: null });
      expect(le.isLeader()).toBe(true);
    });

    it("start() is a no-op when redis is null", async () => {
      const le = new LeaderElection({ redis: null });
      await le.start();
      expect(le.isLeader()).toBe(true);
    });

    it("stop() is a no-op when redis is null", async () => {
      const le = new LeaderElection({ redis: null });
      await le.start();
      await le.stop();
      // Still true — single-instance never loses leadership
      expect(le.isLeader()).toBe(true);
    });

    it("logs single-instance mode message", () => {
      new LeaderElection({ redis: null });
      expect(console.log).toHaveBeenCalledWith(
        "[leader-election] No Redis configured — assuming leadership (single-instance mode)",
      );
    });
  });

  // ── Acquire leadership ─────────────────────────────────────────────────

  describe("acquire leadership", () => {
    it("acquires leadership when SET NX returns OK", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");

      const le = new LeaderElection({
        redis,
        instanceId: "inst-1",
        ttlSeconds: 15,
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        "vectorflow:leader",
        "inst-1",
        "EX",
        15,
        "NX",
      );
      await le.stop();
    });

    it("does not acquire leadership when SET NX returns null", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue(null);

      const le = new LeaderElection({
        redis,
        instanceId: "inst-2",
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(false);
      await le.stop();
    });

    it("logs acquisition message", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");

      const le = new LeaderElection({
        redis,
        instanceId: "inst-log",
        renewIntervalMs: 5000,
      });
      await le.start();
      expect(console.log).toHaveBeenCalledWith(
        "[leader-election] Acquired leadership (instance=inst-log)",
      );
      await le.stop();
    });
  });

  // ── Renewal ─────────────────────────────────────────────────────────────

  describe("renewal", () => {
    it("renews leadership via Lua script", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");
      vi.mocked(redis.eval).mockResolvedValue(1);

      const le = new LeaderElection({
        redis,
        instanceId: "inst-renew",
        ttlSeconds: 15,
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(true);

      // Advance past one renewal tick
      await vi.advanceTimersByTimeAsync(5000);

      expect(redis.eval).toHaveBeenCalled();
      expect(le.isLeader()).toBe(true);
      expect(console.log).toHaveBeenCalledWith(
        "[leader-election] Renewed leadership",
      );
      await le.stop();
    });

    it("loses leadership after 3 consecutive renewal failures", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");
      // Renewal returns 0 (key not ours / expired)
      vi.mocked(redis.eval).mockResolvedValue(0);

      const le = new LeaderElection({
        redis,
        instanceId: "inst-fail",
        ttlSeconds: 15,
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(true);

      // 3 failed renewals
      await vi.advanceTimersByTimeAsync(5000);
      expect(le.isLeader()).toBe(true); // 1 failure
      await vi.advanceTimersByTimeAsync(5000);
      expect(le.isLeader()).toBe(true); // 2 failures
      await vi.advanceTimersByTimeAsync(5000);
      expect(le.isLeader()).toBe(false); // 3 failures → lost

      expect(console.log).toHaveBeenCalledWith(
        "[leader-election] Lost leadership — another instance is leader",
      );
      await le.stop();
    });

    it("resets failure count on successful renewal", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");
      const evalMock = vi.mocked(redis.eval);

      // Fail twice, then succeed, then fail twice — should not lose leadership
      evalMock
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const le = new LeaderElection({
        redis,
        instanceId: "inst-reset",
        ttlSeconds: 15,
        renewIntervalMs: 5000,
      });

      await le.start();

      // 2 failures
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(le.isLeader()).toBe(true);

      // 1 success → reset counter
      await vi.advanceTimersByTimeAsync(5000);
      expect(le.isLeader()).toBe(true);

      // 2 more failures — still under threshold
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(le.isLeader()).toBe(true);

      await le.stop();
    });
  });

  // ── Release on stop ─────────────────────────────────────────────────────

  describe("release on stop", () => {
    it("calls release Lua script and clears timer", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");
      vi.mocked(redis.eval).mockResolvedValue(1);

      const le = new LeaderElection({
        redis,
        instanceId: "inst-release",
        ttlSeconds: 15,
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(true);

      await le.stop();

      // Release Lua script was called
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('del'"),
        1,
        "vectorflow:leader",
        "inst-release",
      );

      expect(le.isLeader()).toBe(false);
      expect(console.log).toHaveBeenCalledWith(
        "[leader-election] Released leadership (shutdown)",
      );
    });

    it("does not call release if not leader", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue(null);

      const le = new LeaderElection({
        redis,
        instanceId: "inst-no-release",
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(false);

      await le.stop();
      // eval should never be called (no renew, no release)
      expect(redis.eval).not.toHaveBeenCalled();
    });
  });

  // ── Only-one-leader invariant ───────────────────────────────────────────

  describe("only-one-leader invariant", () => {
    it("only the first instance acquires leadership", async () => {
      const redis = createMockRedis();
      const setMock = vi.mocked(redis.set);

      // First caller wins, second gets null
      setMock.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

      const le1 = new LeaderElection({
        redis,
        instanceId: "first",
        renewIntervalMs: 5000,
      });
      const le2 = new LeaderElection({
        redis,
        instanceId: "second",
        renewIntervalMs: 5000,
      });

      await le1.start();
      await le2.start();

      expect(le1.isLeader()).toBe(true);
      expect(le2.isLeader()).toBe(false);

      await le1.stop();
      await le2.stop();
    });
  });

  // ── Failover timing ────────────────────────────────────────────────────

  describe("failover", () => {
    it("second instance acquires after first releases", async () => {
      const redis = createMockRedis();
      const setMock = vi.mocked(redis.set);
      vi.mocked(redis.eval).mockResolvedValue(1); // release succeeds

      // First call: first wins. Second call: second loses. Third call (after release): second wins.
      setMock
        .mockResolvedValueOnce("OK")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("OK");

      const le1 = new LeaderElection({
        redis,
        instanceId: "leader-a",
        renewIntervalMs: 5000,
      });
      const le2 = new LeaderElection({
        redis,
        instanceId: "leader-b",
        renewIntervalMs: 5000,
      });

      await le1.start();
      await le2.start();

      expect(le1.isLeader()).toBe(true);
      expect(le2.isLeader()).toBe(false);

      // Leader A shuts down
      await le1.stop();

      // Leader B's next interval tick → tries to acquire
      await vi.advanceTimersByTimeAsync(5000);

      expect(le2.isLeader()).toBe(true);

      await le2.stop();
    });
  });

  // ── Error paths (negative tests) ───────────────────────────────────────

  describe("error handling", () => {
    it("remains non-leader when set() throws", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockRejectedValue(new Error("connection refused"));

      const le = new LeaderElection({
        redis,
        instanceId: "inst-err",
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[leader-election] Error acquiring leadership: connection refused",
      );
      await le.stop();
    });

    it("loses leadership after 3 consecutive eval() errors", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");
      vi.mocked(redis.eval).mockRejectedValue(
        new Error("LOADING Redis is loading"),
      );

      const le = new LeaderElection({
        redis,
        instanceId: "inst-eval-err",
        ttlSeconds: 15,
        renewIntervalMs: 5000,
      });

      await le.start();
      expect(le.isLeader()).toBe(true);

      // 3 consecutive eval errors
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(le.isLeader()).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[leader-election] Error renewing leadership: LOADING Redis is loading",
      );
      await le.stop();
    });

    it("handles release error gracefully", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");
      vi.mocked(redis.eval).mockRejectedValue(
        new Error("connection reset"),
      );

      const le = new LeaderElection({
        redis,
        instanceId: "inst-release-err",
        renewIntervalMs: 5000,
      });

      await le.start();
      // stop() calls release which will error — should not throw
      await expect(le.stop()).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(
        "[leader-election] Error releasing leadership: connection reset",
      );
    });
  });

  // ── Boundary conditions ─────────────────────────────────────────────────

  describe("boundary conditions", () => {
    it("generates a UUID instanceId when not provided", () => {
      const redis = createMockRedis();
      const le = new LeaderElection({ redis });
      expect(le.instanceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("uses custom ttlSeconds and renewIntervalMs", async () => {
      const redis = createMockRedis();
      vi.mocked(redis.set).mockResolvedValue("OK");
      vi.mocked(redis.eval).mockResolvedValue(1);

      const le = new LeaderElection({
        redis,
        instanceId: "inst-custom",
        ttlSeconds: 30,
        renewIntervalMs: 10000,
      });

      await le.start();

      // Should call set with custom TTL
      expect(redis.set).toHaveBeenCalledWith(
        "vectorflow:leader",
        "inst-custom",
        "EX",
        30,
        "NX",
      );

      // Renewal should not have fired at 5s
      await vi.advanceTimersByTimeAsync(5000);
      expect(redis.eval).not.toHaveBeenCalled();

      // But should fire at 10s
      await vi.advanceTimersByTimeAsync(5000);
      expect(redis.eval).toHaveBeenCalled();

      await le.stop();
    });
  });
});
