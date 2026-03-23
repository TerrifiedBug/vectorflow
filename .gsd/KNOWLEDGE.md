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

## Empty State & Error Handling Convention (from M001/S03)

**Pattern:** Use `<EmptyState>` from `@/components/empty-state` for all empty data / no-selection states. Use `<QueryError>` from `@/components/query-error` for all tRPC query error states. Never create inline `border-dashed` empty state divs.

**Error guard placement:** Standard pattern is early return before `isLoading` check. Three variations:
- **Inline ternary** inside `CardContent` when the component renders within a Card wrapper (e.g., `version-check-section.tsx`)
- **Before hide-when-empty** when a section conditionally hides on empty data — error guard must come first so errors are always visible (e.g., `webhooks-section.tsx`)
- **Before main return** when no top-level `isLoading` early return exists (e.g., `audit-shipping-section.tsx`, `backup-settings.tsx`)

**EmptyState compact variant:** Use `className="p-4 text-sm"` when the EmptyState is nested inside an already-padded container (e.g., environment guards in library pages).

**Diagnostic shortcut:** `rg 'border border-dashed' src/app/\(dashboard\)/` should always return 0 matches. If it finds any, a new page was added without using the shared component.

## Test Infrastructure Conventions (from M001/S04)

**BigInt in tests:** The project's `tsconfig.json` targets `ES2017`, which does not support bigint literal syntax (`0n`, `100n`). Use `BigInt(0)`, `BigInt(100)` constructor calls instead. Vitest's own transpiler handles this at runtime, but `tsc --noEmit` will reject bigint literals.

**Prisma mock pattern:** The T01 mock helper (`src/__mocks__/lib/prisma.ts`) used a `require()` approach that breaks when actually exercised. The proven pattern (validated in T03) is inline per-test-file:
```ts
vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));
import { prisma } from "@/lib/prisma";
const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
```
The `vi.mock` factory is hoisted and runs before the mocked module's first import. The `prisma` import then gives you the mock object. Cast to `DeepMockProxy` for type-safe mock API access. Call `mockReset(prismaMock)` in `beforeEach` to prevent state leaks between tests.

**Path aliases in tests:** `vitest.config.ts` mirrors `tsconfig.json` paths: `@/` resolves to `./src/`. Tests import from `@/server/services/...` just like production code.

## Multi-Module Mocking Convention (from M001/S04)

**Pattern:** Services with many dependencies (e.g., `deploy-agent.ts` depends on 8 modules) need one `vi.mock()` call per module. Each gets its own factory. Order doesn't matter since `vi.mock` is hoisted.

**Tx parameter mocking:** Pass `prismaMock as unknown as Tx` — the `DeepMockProxy` satisfies the `Prisma.TransactionClient` interface for transaction-scoped functions like `saveGraphComponents`.

**Singleton mocking:** For singletons that expose methods (like `pushRegistry.send()`), mock the entire module: `vi.mock("@/server/services/push-registry", () => ({ pushRegistry: { send: vi.fn() } }))`. Then import and cast to access the mock.

**Environment variable isolation:** For tests that depend on env vars (like `crypto.test.ts` needing `NEXTAUTH_SECRET`), save/restore `process.env` in `beforeAll`/`afterAll` and use `try/finally` blocks for per-test mutations. Never leave env mutations dangling.

**Fake timers for time-dependent logic:** Use `vi.useFakeTimers()` + `vi.setSystemTime()` to simulate time progression (e.g., alert duration tracking). Always restore with `vi.useRealTimers()` in `afterEach`.

## @next/bundle-analyzer + Turbopack Incompatibility (from M001/S05)

**Gotcha:** Next.js 16 defaults to Turbopack for builds. `@next/bundle-analyzer` uses the webpack `BundleAnalyzerPlugin` under the hood, so `ANALYZE=true pnpm build` silently produces no report files when Turbopack is active. The plugin prints a warning to stderr but the build succeeds with exit 0.

**Workaround:** Run `ANALYZE=true pnpm build --webpack` to force webpack mode and generate `.next/analyze/*.html` reports. Alternatively, use `next experimental-analyze` for Turbopack-native analysis (different output format).
