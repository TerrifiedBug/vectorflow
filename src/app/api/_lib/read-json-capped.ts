import { NextResponse } from "next/server";

/**
 * Hard request-body byte cap for agent ingestion routes.
 *
 * Next.js `serverActions.bodySizeLimit` only bounds Server Actions, NOT
 * Route Handlers. Without an explicit cap, a single large POST from a
 * valid (or leaked) agent/node token streams unbounded into memory and
 * can OOM the process. This helper enforces a cap before the body is
 * materialised.
 *
 * Default 8 MiB, override with `VF_AGENT_MAX_BODY_BYTES`. The default is
 * generous enough for batched log/sample/tap payloads while still
 * preventing memory exhaustion.
 */
export const DEFAULT_AGENT_MAX_BODY_BYTES = 8 * 1024 * 1024;

export function agentMaxBodyBytes(): number {
  const raw = process.env.VF_AGENT_MAX_BODY_BYTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AGENT_MAX_BODY_BYTES;
}

function payloadTooLarge(maxBytes: number): Response {
  return NextResponse.json(
    { error: "Payload too large", maxBytes },
    { status: 413 },
  );
}

function invalidJson(): Response {
  return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
}

export type CappedJson<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

function parseJson<T>(text: string): CappedJson<T> {
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: invalidJson() };
  }
}

/**
 * Read and JSON-parse a request body with a hard byte cap.
 *
 * Returns `{ ok: false, response }` with:
 *   - `413` when the declared `Content-Length` exceeds the cap (fast path),
 *     OR the streamed body exceeds it (defends against a missing/forged
 *     `Content-Length` or chunked transfer), and
 *   - `400` when the body is not valid JSON.
 *
 * Callers replace `const body = await request.json()` with:
 *   const read = await readJsonCapped(request);
 *   if (!read.ok) return read.response;
 *   const body = read.data;
 */
export async function readJsonCapped<T = unknown>(
  request: Request,
  maxBytes: number = agentMaxBodyBytes(),
): Promise<CappedJson<T>> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, response: payloadTooLarge(maxBytes) };
    }
  }

  const body = request.body;
  if (!body) {
    const text = await request.text();
    if (Buffer.byteLength(text) > maxBytes) {
      return { ok: false, response: payloadTooLarge(maxBytes) };
    }
    return parseJson<T>(text);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, response: payloadTooLarge(maxBytes) };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return parseJson<T>(text);
}
