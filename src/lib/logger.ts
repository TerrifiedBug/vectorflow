import { env } from "@/lib/env";

const level = (env.VF_LOG_LEVEL ?? env.LOG_LEVEL ?? "info").toLowerCase();
const isDebug = level === "debug" || level === "trace";

function sanitizeLogString(value: string): string {
  // Remove newline and carriage return characters to prevent log injection
  return value.replace(/[\r\n]/g, "");
}

export function debugLog(tag: string, message: string, data?: unknown): void {
  if (!isDebug) return;
  const ts = new Date().toISOString();
  const safeTag = sanitizeLogString(tag);
  const safeMessage = sanitizeLogString(message);
  if (data !== undefined) {
    console.log("%s [%s] %s", ts, safeTag, safeMessage, data);
  } else {
    console.log("%s [%s] %s", ts, safeTag, safeMessage);
  }
}

export function infoLog(tag: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const safeTag = sanitizeLogString(tag);
  const safeMessage = sanitizeLogString(message);
  if (data !== undefined) {
    console.log("%s [%s] %s", ts, safeTag, safeMessage, data);
  } else {
    console.log("%s [%s] %s", ts, safeTag, safeMessage);
  }
}

export function warnLog(tag: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const safeTag = sanitizeLogString(tag);
  const safeMessage = sanitizeLogString(message);
  if (data !== undefined) {
    console.warn("%s [%s] %s", ts, safeTag, safeMessage, data);
  } else {
    console.warn("%s [%s] %s", ts, safeTag, safeMessage);
  }
}

export function errorLog(tag: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const safeTag = sanitizeLogString(tag);
  const safeMessage = sanitizeLogString(message);
  if (data !== undefined) {
    console.error("%s [%s] %s", ts, safeTag, safeMessage, data);
  } else {
    console.error("%s [%s] %s", ts, safeTag, safeMessage);
  }
}
