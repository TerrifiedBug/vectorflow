import { env } from "@/lib/env";
import { getLogContext } from "@/lib/log-context";

const level = env.VF_LOG_LEVEL.toLowerCase();
const isDebug = level === "debug" || level === "trace";

/** Strip CR/LF to prevent log injection via user-controlled strings. */
function sanitizeMsg(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Serialize `data` to a JSON-safe value.  Error objects are expanded to
 * `{ name, message, stack }` because `JSON.stringify(new Error())` yields `{}`.
 */
function serializeData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  return data;
}

/**
 * Write a single newline-terminated JSON record to `stream`.
 * Falls back gracefully when the payload contains un-serialisable values
 * (circular references, BigInt, etc.) so the logger never throws.
 */
function emit(
  stream: NodeJS.WriteStream,
  record: Record<string, unknown>,
): void {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    const safe = { ...record, data: "[unserializable]" };
    try {
      line = JSON.stringify(safe);
    } catch {
      line = `{"ts":"${record["ts"]}","level":"${record["level"]}","tag":"${record["tag"]}","msg":"[logger serialization failure]"}`;
    }
  }
  stream.write(line + "\n");
}

function buildRecord(
  lvl: string,
  tag: string,
  message: string,
  data: unknown,
): Record<string, unknown> {
  const ctx = getLogContext();
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: lvl,
    tag: sanitizeMsg(tag),
    msg: sanitizeMsg(message),
  };
  if (ctx?.orgId) record["organization_id"] = ctx.orgId;
  if (ctx?.requestId) record["request_id"] = ctx.requestId;
  if (data !== undefined) record["data"] = serializeData(data);
  return record;
}

export function debugLog(tag: string, message: string, data?: unknown): void {
  if (!isDebug) return;
  emit(process.stdout, buildRecord("debug", tag, message, data));
}

export function infoLog(tag: string, message: string, data?: unknown): void {
  emit(process.stdout, buildRecord("info", tag, message, data));
}

export function warnLog(tag: string, message: string, data?: unknown): void {
  emit(process.stderr, buildRecord("warn", tag, message, data));
}

export function errorLog(tag: string, message: string, data?: unknown): void {
  emit(process.stderr, buildRecord("error", tag, message, data));
}
