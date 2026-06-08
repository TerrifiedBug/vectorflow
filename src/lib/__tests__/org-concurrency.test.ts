import { describe, it, expect } from "vitest";
import { withOrgConcurrencyLimit } from "../org-concurrency";

/**
 * Drain the microtask queue so all pending acquire/handoff continuations settle
 * before we assert. The limiter is microtask-only, so a single macrotask tick
 * (setImmediate) runs strictly after every queued handoff.
 */
function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

describe("withOrgConcurrencyLimit", () => {
  it("never runs more than `max` tasks at once for one org, draining FIFO", async () => {
    const gates = Array.from({ length: 5 }, () => Promise.withResolvers<void>());
    let running = 0;
    let peak = 0;
    const startOrder: number[] = [];

    const tasks = gates.map((gate, i) =>
      withOrgConcurrencyLimit("org-cap", "k", 2, async () => {
        running++;
        peak = Math.max(peak, running);
        startOrder.push(i);
        await gate.promise;
        running--;
      }),
    );

    // Only the first two acquire a slot; tasks 2..4 queue.
    await flush();
    expect(running).toBe(2);
    expect(startOrder).toEqual([0, 1]);

    // Each released slot admits exactly the next FIFO waiter — never a 3rd at once.
    gates[0].resolve();
    await flush();
    expect(running).toBe(2);
    expect(startOrder).toEqual([0, 1, 2]);

    gates[1].resolve();
    await flush();
    expect(running).toBe(2);
    expect(startOrder).toEqual([0, 1, 2, 3]);

    gates[2].resolve();
    await flush();
    expect(startOrder).toEqual([0, 1, 2, 3, 4]);

    gates[3].resolve();
    gates[4].resolve();
    await Promise.all(tasks);

    expect(peak).toBe(2);
  });

  it("isolates the limit per org — a saturated org never blocks another", async () => {
    const aGate = Promise.withResolvers<void>();
    let aFirstRunning = false;
    let aSecondRan = false;
    let bRan = false;

    // org-a (cap 1) is held open by its first task.
    const aFirst = withOrgConcurrencyLimit("org-a", "k", 1, async () => {
      aFirstRunning = true;
      await aGate.promise;
    });
    await flush();
    expect(aFirstRunning).toBe(true);

    // A second org-a task must queue (cap reached) ...
    const aSecond = withOrgConcurrencyLimit("org-a", "k", 1, async () => {
      aSecondRan = true;
    });
    // ... while org-b is independent and runs immediately.
    const bTask = withOrgConcurrencyLimit("org-b", "k", 1, async () => {
      bRan = true;
    });

    await flush();
    expect(bRan).toBe(true); // org-b unaffected by org-a's saturation
    expect(aSecondRan).toBe(false); // org-a still at its cap

    aGate.resolve();
    await Promise.all([aFirst, aSecond, bTask]);
    expect(aSecondRan).toBe(true);
  });

  it("isolates different keys within the same org", async () => {
    const gate = Promise.withResolvers<void>();
    let key2Ran = false;

    const key1 = withOrgConcurrencyLimit("org-keys", "key-1", 1, async () => {
      await gate.promise;
    });
    await flush();

    const key2 = withOrgConcurrencyLimit("org-keys", "key-2", 1, async () => {
      key2Ran = true;
    });
    await flush();
    expect(key2Ran).toBe(true); // distinct key → its own slot, not blocked by key-1

    gate.resolve();
    await Promise.all([key1, key2]);
  });

  it("releases the slot when fn throws, admitting the next waiter", async () => {
    const gate = Promise.withResolvers<void>();
    let secondRan = false;

    const first = withOrgConcurrencyLimit("org-throw", "k", 1, async () => {
      await gate.promise;
      throw new Error("boom");
    });
    first.catch(() => {}); // handled below via expect().rejects; avoid unhandled-rejection noise

    const second = withOrgConcurrencyLimit("org-throw", "k", 1, async () => {
      secondRan = true;
    });

    await flush();
    expect(secondRan).toBe(false); // queued behind the still-running first

    gate.resolve();
    await expect(first).rejects.toThrow("boom");

    await second;
    expect(secondRan).toBe(true); // slot was released despite the throw
  });

  it("routes a missing/empty orgId to a shared 'global' bucket", async () => {
    const gate = Promise.withResolvers<void>();
    let firstRunning = false;
    let secondRan = false;

    const first = withOrgConcurrencyLimit("", "global-key", 1, async () => {
      firstRunning = true;
      await gate.promise;
    });
    // Whitespace-only orgId collapses to the same "global" bucket as "".
    const second = withOrgConcurrencyLimit("   ", "global-key", 1, async () => {
      secondRan = true;
    });

    await flush();
    expect(firstRunning).toBe(true);
    expect(secondRan).toBe(false); // shares first's bucket → must queue

    gate.resolve();
    await Promise.all([first, second]);
    expect(secondRan).toBe(true);
  });

  it("returns fn's resolved value", async () => {
    const value = await withOrgConcurrencyLimit("org-ret", "k", 2, async () => 42);
    expect(value).toBe(42);
  });
});
