# Knowledge Base

<!-- Append-only. Patterns, gotchas, and non-obvious lessons learned during execution.
     Only add entries that would save a future agent from repeating investigation. -->

## Shared Utility Module Convention (from M001/S01)

**Pattern:** All pipeline status derivation imports from `@/lib/pipeline-status`, time formatting from `@/lib/format`, status color helpers from `@/lib/status`. No inline utility definitions in consumer files.

**Key distinction:** `formatTime` returns HH:MM (used in dashboard cards, charts), `formatTimeWithSeconds` returns HH:MM:SS (used in log viewers like `node-logs.tsx` and `pipeline-logs.tsx`). Don't mix them up — logs need seconds precision.

**Gotcha:** `event-log.tsx` defines `STATUS_COLORS` locally but only uses `statusColor()` — importing the unused constant triggers an eslint warning. Only import what's actually referenced.

**Diagnostic shortcut:** `rg 'export function|export const' src/lib/pipeline-status.ts src/lib/format.ts src/lib/status.ts` shows the full shared API surface at a glance.
