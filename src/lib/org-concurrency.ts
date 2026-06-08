/**
 * In-process per-(org, key) async concurrency limiter.
 *
 * Some server operations shell out to an expensive shared resource — most
 * notably `evaluateVrl` (transform-eval.ts), which spawns a `vector` subprocess.
 * Without a per-tenant bound, one organization issuing many concurrent requests
 * (live-tap iteration, cost what-if, unit-test "run all") can spawn unbounded
 * subprocesses and starve the shared host for every other tenant.
 *
 * `withOrgConcurrencyLimit(orgId, key, max, fn)` caps how many `fn`s run at once
 * for a given (orgId, key) pair, queueing the rest FIFO and admitting the next
 * waiter as each slot frees. The slot is always released — on success or throw.
 * This is a single-process primitive (one Node worker): fairness within a host,
 * not a distributed limiter.
 *
 * A missing/empty `orgId` falls back to a shared `"global"` bucket so callers
 * without org context still get a bound rather than none.
 */

/** Per-(org, key) counting semaphore: `max` slots and a FIFO queue of waiters. */
interface Semaphore {
  max: number;
  active: number;
  /** FIFO resolvers; calling one admits that waiter into a freed slot. */
  queue: Array<() => void>;
}

/** Live buckets keyed by `"<org>\u0000<key>"`. Idle buckets are deleted. */
const semaphores = new Map<string, Semaphore>();

function getSemaphore(mapKey: string, max: number): Semaphore {
  let sem = semaphores.get(mapKey);
  if (!sem) {
    // The bound is fixed when the bucket is created (and re-established if the
    // bucket is recreated after going idle); callers MUST pass a consistent
    // `max` per (orgId, key). Clamp to >= 1 so a stray 0 can't deadlock.
    sem = { max: Math.max(1, Math.floor(max)), active: 0, queue: [] };
    semaphores.set(mapKey, sem);
  }
  return sem;
}

/** Acquire a slot — resolves immediately if one is free, else queues FIFO. */
function acquire(sem: Semaphore): Promise<void> {
  if (sem.active < sem.max) {
    sem.active++;
    return Promise.resolve();
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  sem.queue.push(resolve);
  return promise;
}

/**
 * Release a held slot. If a waiter is queued, hand the slot directly to it —
 * `active` is unchanged, the slot transfers — which preserves FIFO and stops a
 * newcomer from jumping the queue. Otherwise free the slot, deleting the bucket
 * once it is fully idle so the Map stays proportional to live concurrency
 * rather than the historical org count.
 */
function release(mapKey: string, sem: Semaphore): void {
  const next = sem.queue.shift();
  if (next) {
    next();
    return;
  }
  sem.active--;
  if (sem.active <= 0 && sem.queue.length === 0) {
    semaphores.delete(mapKey);
  }
}

/**
 * Run `fn` under a per-(orgId, key) concurrency cap of `max`. At most `max`
 * `fn`s run concurrently for the pair; the rest queue FIFO and drain as slots
 * free. The slot is always released, on success or throw.
 */
export async function withOrgConcurrencyLimit<T>(
  orgId: string,
  key: string,
  max: number,
  fn: () => Promise<T>,
): Promise<T> {
  // NUL-join keeps the composite key unambiguous (NUL cannot appear in an id);
  // an empty/whitespace orgId collapses to a shared "global" bucket.
  const mapKey = `${orgId.trim() || "global"}\u0000${key}`;
  const sem = getSemaphore(mapKey, max);
  await acquire(sem);
  try {
    return await fn();
  } finally {
    release(mapKey, sem);
  }
}
