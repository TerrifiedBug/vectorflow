const level = (process.env.VF_LOG_LEVEL ?? process.env.LOG_LEVEL ?? "info").toLowerCase();
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
