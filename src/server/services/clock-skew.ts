/**
 * Clock-skew canary.
 *
 * Compares the local clock against the `Date:` HTTP response header from one
 * or more public time sources. Returns the median signed skew in seconds:
 *   positive  → local clock is behind the time source(s)
 *   negative  → local clock is ahead
 *
 * Used by `/api/health/cloud` to fail readiness when the host drifts too
 * far. Several control-plane invariants (JWT expiry, TOTP windows, KMS
 * grant token expiry) silently misbehave when stamp hosts disagree on the
 * time of day.
 *
 * Defaults to a small set of high-availability public NTP-backed HTTP
 * endpoints. Override via `sources` in tests or to point at an internal
 * time service.
 */

export interface MeasureOptions {
  sources?: string[];
  /** Per-source HTTP timeout. */
  timeoutMs?: number;
  /**
   * Resolve as soon as `minSamples` sources have returned a sample, even
   * if others are still pending. Defaults to a sensible per-source-count
   * value (1 when only one source is supplied; otherwise 2).
   */
  minSamples?: number;
  fetchImpl?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_SOURCES = [
  "https://time.cloudflare.com/",
  "https://www.google.com/generate_204",
  "https://www.apple.com/library/test/success.html",
];

export async function measureClockSkewSeconds(
  opts: MeasureOptions = {},
): Promise<number> {
  const sources = opts.sources ?? DEFAULT_SOURCES;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const minSamples = opts.minSamples ?? (sources.length >= 2 ? 2 : 1);

  const samples: number[] = [];
  let done = false;
  let resolveEnough!: () => void;
  const enough = new Promise<void>((res) => {
    resolveEnough = res;
  });

  // Per-source AbortControllers tracked here so we can cancel leftover
  // in-flight fetches when quorum is reached. Otherwise frequent
  // readiness probes against a slow source would accumulate outbound
  // requests/sockets.
  const controllers: AbortController[] = [];
  const cancelOutstanding = (): void => {
    for (const ac of controllers) {
      if (!ac.signal.aborted) ac.abort();
    }
  };

  const fetchOne = (url: string) =>
    (async () => {
      const ac = new AbortController();
      controllers.push(ac);
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const sentAt = Date.now();
        const res = await fetchImpl(url, { method: "HEAD", signal: ac.signal });
        const receivedAt = Date.now();
        const dateHeader = res.headers.get("date");
        if (!dateHeader) return;
        const serverTime = Date.parse(dateHeader);
        if (Number.isNaN(serverTime)) return;
        const localMid = (sentAt + receivedAt) / 2;
        const sample = Math.round((serverTime - localMid) / 1000);
        if (done) return;
        samples.push(sample);
        if (samples.length >= minSamples) {
          done = true;
          resolveEnough();
          cancelOutstanding();
        }
      } catch {
        /* drop failing source */
      } finally {
        clearTimeout(timer);
      }
    })();

  const inflight = sources.map(fetchOne);
  // Race "we have enough" vs "every source has completed" — whichever
  // settles first returns control. When `enough` resolves, the abort
  // path above kicks the remaining in-flight requests so they don't
  // linger past the caller's awaited return.
  await Promise.race([enough, Promise.allSettled(inflight)]);

  if (samples.length === 0) {
    throw new Error("clock-skew: no clock sources responded");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export interface ClockSkewCheck {
  ok: boolean;
  skewSeconds: number;
  thresholdSeconds: number;
  message: string;
}

/** Convenience: returns `ok=false` when |skew| exceeds the threshold. */
export async function checkClockSkew(
  thresholdSeconds = 2,
  opts: MeasureOptions = {},
): Promise<ClockSkewCheck> {
  try {
    const skew = await measureClockSkewSeconds(opts);
    return {
      ok: Math.abs(skew) <= thresholdSeconds,
      skewSeconds: skew,
      thresholdSeconds,
      message:
        Math.abs(skew) <= thresholdSeconds
          ? `clock skew ${skew}s within ±${thresholdSeconds}s`
          : `clock skew ${skew}s exceeds ±${thresholdSeconds}s`,
    };
  } catch (err) {
    return {
      ok: false,
      skewSeconds: 0,
      thresholdSeconds,
      message: `clock-skew probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
