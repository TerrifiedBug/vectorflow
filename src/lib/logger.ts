const level = (process.env.VF_LOG_LEVEL ?? process.env.LOG_LEVEL ?? "info").toLowerCase();
const isDebug = level === "debug" || level === "trace";

export function debugLog(tag: string, message: string, data?: unknown): void {
  if (!isDebug) return;
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`${ts} [${tag}] ${message}`, data);
  } else {
    console.log(`${ts} [${tag}] ${message}`);
  }
}
