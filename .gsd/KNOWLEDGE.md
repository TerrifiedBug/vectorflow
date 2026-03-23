# Knowledge Base

<!-- Append-only. Patterns, gotchas, and non-obvious lessons learned during execution.
     Only add entries that would save a future agent from repeating investigation. -->

## Shared Utility Module Convention (from M001/S01)

**Pattern:** All pipeline status derivation imports from `@/lib/pipeline-status`, time formatting from `@/lib/format`, status color helpers from `@/lib/status`. No inline utility definitions in consumer files.

**Key distinction:** `formatTime` returns HH:MM (used in dashboard cards, charts), `formatTimeWithSeconds` returns HH:MM:SS (used in log viewers like `node-logs.tsx` and `pipeline-logs.tsx`). Don't mix them up — logs need seconds precision.

**Gotcha:** `event-log.tsx` defines `STATUS_COLORS` locally but only uses `statusColor()` — importing the unused constant triggers an eslint warning. Only import what's actually referenced.

**Diagnostic shortcut:** `rg 'export function|export const' src/lib/pipeline-status.ts src/lib/format.ts src/lib/status.ts` shows the full shared API surface at a glance.

## Service Extraction Convention (from M001/S02)

**Pattern:** Service modules in `src/server/services/` export pure functions. They import `prisma` from `@/lib/prisma` and throw `TRPCError` directly for error paths. For transaction-scoped work, functions accept a `Tx` (Prisma TransactionClient) parameter. Services must remain **stateless** — all singleton access (e.g., `metricStore`), audit metadata assignment, and middleware chains stay in the router.

**Existing services:** `pipeline-graph.ts` (5 exports, 621 lines), `dashboard-data.ts` (3 exports, 449 lines), `pipeline-version.ts` (pre-existing).

**Testing implication:** Service functions accept plain parameters (userId, pipelineId, DB query results) — not tRPC `ctx`. This means S04 tests can call them directly without mocking tRPC context. `pipeline-graph.ts` has 15 TRPCError throw sites — all testable failure paths.

**Gotcha:** When extracting, watch for `Prisma.InputJsonValue` type casts — router code may use `as unknown as typeof node.config` which resolves to `Record<string, unknown>` (not Prisma-compatible). Use explicit `Prisma.InputJsonValue` casts in the service.

## Dialog Extraction Convention (from M001/S02)

**Pattern:** Extracted dialog components receive: open state (member/user object or `null`), `onClose` callback, `isPending` boolean, and `onConfirm` callback. The parent retains mutation hooks and passes them as callbacks. This avoids duplicating tRPC hook setup in the dialog.

**Threshold:** If a dialog is already a concise `ConfirmDialog` one-liner, keep it inline. Only extract dialogs that have their own form fields, state management, or complex UI.

**Gotcha:** When a dialog manages its own form state (like `CreateUserDialog`), have it reset state in its `onOpenChange` handler rather than requiring the parent to manage reset. This can eliminate multiple parent `useState` hooks.
