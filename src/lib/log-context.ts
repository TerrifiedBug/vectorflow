/**
 * Per-request log context (plan §11).
 *
 * Async-local-storage carrier for `orgId` (and a request-scoped
 * `requestId` for trace correlation) so every log line emitted from
 * inside a tRPC request or agent handler can be tagged without
 * threading the value through every function signature.
 *
 * Usage:
 *
 *   // At the request boundary (tRPC context creator, agent route
 *   // handler), wrap the request execution in `runWithLogContext`:
 *
 *   import { runWithLogContext } from "@/lib/log-context";
 *
 *   return runWithLogContext({ orgId, requestId }, async () => {
 *     return next();
 *   });
 *
 *   // Anywhere inside the wrapped code, the logger picks up the
 *   // context automatically:
 *
 *   infoLog("audit", "wrote row");
 *   // → 2026-05-17T12:00:00.000Z [audit] {org=org-abc req=req-123} wrote row
 *
 * Off the wrapped code path (e.g. background cron jobs that run with
 * `null` context), the logger emits no `{org=…}` segment — keeps the
 * output stable for non-tenant work.
 *
 * Why AsyncLocalStorage and not a request-scoped context manager:
 *
 *   - tRPC procedures invoke nested service functions across many
 *     files; passing `orgId` through every call would be invasive.
 *   - Sentry's `beforeSend` (called from inside `console.error`
 *     handlers) needs access to the org id without a hand-threaded
 *     parameter; ALS gives it `getLogContext()` directly.
 *   - Node's `AsyncLocalStorage` is propagated across `await` /
 *     `Promise.then` boundaries by the runtime, so the context
 *     follows the request through any async chain inside the
 *     wrapped function.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  /** Organization the current request is acting on. */
  orgId?: string;
  /**
   * Request correlation id — random ULID/UUID generated at the
   * request boundary. Propagated to Sentry events + structured log
   * lines so a single user-facing failure can be reconstructed from
   * server logs.
   */
  requestId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/**
 * Run `fn` inside a new context store. Inner stores merge over the
 * outer one (an inner `runWithLogContext({ orgId: "b" }, ...)` shadows
 * an outer `orgId: "a"` for the duration of the inner call).
 */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const outer = storage.getStore();
  const merged: LogContext = outer ? { ...outer, ...ctx } : { ...ctx };
  return storage.run(merged, fn);
}

/**
 * Read the current context. Returns `undefined` when called outside
 * any `runWithLogContext` (e.g. boot-time logging, top-level cron
 * tick).
 */
export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

/**
 * Format the context into a compact log suffix.
 *
 *   `{ orgId: "abc", requestId: "r-1" }` → `"{org=abc req=r-1} "`
 *   `{ orgId: "abc" }`                    → `"{org=abc} "`
 *   `{}` or `undefined`                   → `""`  (no segment emitted)
 *
 * Trailing space included so callers can prepend without extra
 * whitespace logic. Empty context = empty string so non-tenant logs
 * are unchanged.
 */
export function formatLogContext(ctx: LogContext | undefined): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.orgId) parts.push(`org=${ctx.orgId}`);
  if (ctx.requestId) parts.push(`req=${ctx.requestId}`);
  if (parts.length === 0) return "";
  return `{${parts.join(" ")}} `;
}

/**
 * Test helper: clear the current context. Production code never calls
 * this — ALS stores are scoped to the `run` call, so they self-clear
 * when the wrapped function returns.
 */
export const _logContextInternals = {
  storage,
};
