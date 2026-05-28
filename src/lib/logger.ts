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
 * Write a single JSON record. Routes through `console.{log,warn,error,debug}`
 * (which writes to stdout/stderr under the hood) so existing test
 * fixtures that `vi.spyOn(console, "log")` continue to intercept
 * the call. The single argument is the JSON-stringified record;
 * tests that need to assert on contents should `JSON.parse(args[0])`
 * or substring-match the string.
 */
function emit(
  consoleFn: (line: string) => void,
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
  consoleFn(line);
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
  // eslint-disable-next-line no-console
  emit(console.debug.bind(console), buildRecord("debug", tag, message, data));
}

export function infoLog(tag: string, message: string, data?: unknown): void {
  // Route through console.log (not console.info) — the rest of the
  // codebase's test fixtures spy on console.log for info-level
  // assertions; console.* are separate references on the console
  // object so the routing matters for spy attachment.
  // eslint-disable-next-line no-console
  emit(console.log.bind(console), buildRecord("info", tag, message, data));
}

export function warnLog(tag: string, message: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  emit(console.warn.bind(console), buildRecord("warn", tag, message, data));
}

export function errorLog(tag: string, message: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  emit(console.error.bind(console), buildRecord("error", tag, message, data));
}
