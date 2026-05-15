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
  timeoutMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
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

  const samples = await Promise.all(
    sources.map(async (url) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const sentAt = Date.now();
        const res = await fetchImpl(url, {
          method: "HEAD",
          signal: ac.signal,
        });
        const receivedAt = Date.now();
        const dateHeader = res.headers.get("date");
        if (!dateHeader) return null;
        const serverTime = Date.parse(dateHeader);
        if (Number.isNaN(serverTime)) return null;
        // Round-trip-corrected: assume the server stamped the response halfway
        // between when we sent the request and when we got the headers back.
        const localMid = (sentAt + receivedAt) / 2;
        return Math.round((serverTime - localMid) / 1000);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const valid = samples.filter((s): s is number => s !== null);
  if (valid.length === 0) {
    throw new Error("clock-skew: no clock sources responded");
  }
  // Median is robust against a single bad sample.
  const sorted = [...valid].sort((a, b) => a - b);
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
