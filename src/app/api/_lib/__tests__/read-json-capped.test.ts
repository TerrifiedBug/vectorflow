import { describe, it, expect } from "vitest";
import { readJsonCapped } from "@/app/api/_lib/read-json-capped";

function jsonRequest(body: string): Request {
  // A string body causes undici to set an accurate Content-Length header,
  // which exercises the fast-path header check.
  return new Request("https://example.test/api/agent/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function streamingRequest(totalBytes: number, chunk = 1024): Request {
  // A ReadableStream body has no Content-Length (chunked transfer), so it
  // exercises the streamed byte-count cap rather than the header check.
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunk, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(120)); // 'x'
      sent += size;
    },
  });
  return new Request("https://example.test/api/agent/logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    // @ts-expect-error duplex is required by undici for a stream body
    duplex: "half",
  });
}

describe("readJsonCapped", () => {
  it("parses a valid JSON body under the cap", async () => {
    const result = await readJsonCapped<{ hello: string }>(
      jsonRequest(JSON.stringify({ hello: "world" })),
      1024,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.hello).toBe("world");
  });

  it("rejects with 413 when Content-Length exceeds the cap (fast path)", async () => {
    const big = JSON.stringify({ blob: "a".repeat(500) });
    const result = await readJsonCapped(jsonRequest(big), 50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("rejects with 413 when a streamed body exceeds the cap (no Content-Length)", async () => {
    const result = await readJsonCapped(streamingRequest(8192), 4096);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("rejects with 400 on invalid JSON under the cap", async () => {
    const result = await readJsonCapped(jsonRequest("{not valid json"), 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("honors VF_AGENT_MAX_BODY_BYTES override", async () => {
    const prev = process.env.VF_AGENT_MAX_BODY_BYTES;
    process.env.VF_AGENT_MAX_BODY_BYTES = "16";
    try {
      const result = await readJsonCapped(
        jsonRequest(JSON.stringify({ padding: "0123456789abcdef" })),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(413);
    } finally {
      if (prev === undefined) delete process.env.VF_AGENT_MAX_BODY_BYTES;
      else process.env.VF_AGENT_MAX_BODY_BYTES = prev;
    }
  });
});
