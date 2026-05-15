import { describe, it, expect } from "vitest";
import { measureClockSkewSeconds } from "../clock-skew";

describe("measureClockSkewSeconds — aborts pending probes after quorum (Codex P2)", () => {
  function dateResp(d: Date): Response {
    return new Response(null, {
      status: 200,
      headers: { date: d.toUTCString() },
    });
  }

  it("aborts slow sources once minSamples is reached", async () => {
    const now = new Date();
    let slowAborted = false;
    let resolveSlow: ((r: Response) => void) | undefined;

    const result = await measureClockSkewSeconds({
      sources: ["https://fast1.example", "https://fast2.example", "https://slow.example"],
      timeoutMs: 60_000,
      minSamples: 2,
      fetchImpl: (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "https://slow.example") {
          return new Promise<Response>((resolve, reject) => {
            resolveSlow = resolve;
            init?.signal?.addEventListener("abort", () => {
              slowAborted = true;
              reject(new Error("aborted"));
            });
          });
        }
        return Promise.resolve(dateResp(now));
      },
    });

    expect(Math.abs(result)).toBeLessThanOrEqual(1);
    expect(slowAborted).toBe(true);
    // Cleanup any not-yet-aborted: the abort fired, so the slow promise
    // already rejected. No further action needed; just satisfy TS.
    if (resolveSlow) {
      /* slow already rejected */
    }
  });
});
