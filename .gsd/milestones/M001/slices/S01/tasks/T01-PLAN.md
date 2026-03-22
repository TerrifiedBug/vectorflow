---
estimated_steps: 4
estimated_files: 3
skills_used: []
---

# T01: Create shared utility modules for pipeline status, time formatting, and status colors

**Slice:** S01 — TypeScript Fixes & Shared Utilities
**Milestone:** M001

## Description

Create `src/lib/pipeline-status.ts` as a new shared module and extend `src/lib/format.ts` and `src/lib/status.ts` with functions currently duplicated across consumer files. This establishes the shared API surface that T02 will wire consumers into, and produces the `src/lib/pipeline-status.ts` boundary contract that downstream slices S02–S05 depend on.

## Steps

1. Create `src/lib/pipeline-status.ts` with two exported functions:
   - `aggregateProcessStatus(statuses: Array<{ status: string }>): "RUNNING" | "STARTING" | "STOPPED" | "CRASHED" | "PENDING" | null` — returns the worst-case status across processes. Logic: empty → null, any CRASHED → CRASHED, any STOPPED → STOPPED, any STARTING → STARTING, any PENDING → PENDING, else RUNNING.
   - `derivePipelineStatus(nodes: Array<{ pipelineStatus: string }>): string` — derives overall pipeline status from node statuses. Logic: empty → "PENDING", any CRASHED → "CRASHED", any RUNNING → "RUNNING", any STARTING → "STARTING", all STOPPED → "STOPPED", else first node's status.

2. Add two new exports to `src/lib/format.ts` (append after existing functions):
   - `formatTime(date: Date | string): string` — HH:MM format: `new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`
   - `formatTimeWithSeconds(date: Date | string): string` — HH:MM:SS format: `new Date(date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })`
   - Also update the existing `formatTimestamp` function to use explicit locale options: `d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })` — this makes it match the audit page's more detailed version so the audit page can import it instead of defining its own.

3. Add two new exports to `src/lib/status.ts` (append after existing functions):
   - `const STATUS_COLORS: Record<string, string> = { HEALTHY: "#22c55e", UNREACHABLE: "#ef4444", DEGRADED: "#f59e0b", UNKNOWN: "#6b7280" }`
   - `function statusColor(status: string | null | undefined): string` — returns `STATUS_COLORS[status ?? "UNKNOWN"] ?? "#6b7280"`

4. Run `pnpm exec tsc --noEmit` to verify the new exports compile cleanly.

## Must-Haves

- [ ] `src/lib/pipeline-status.ts` exports `aggregateProcessStatus` and `derivePipelineStatus`
- [ ] `src/lib/format.ts` exports `formatTime` and `formatTimeWithSeconds`
- [ ] `src/lib/status.ts` exports `STATUS_COLORS` and `statusColor`
- [ ] `tsc --noEmit` passes with zero errors

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `test -f src/lib/pipeline-status.ts` exits 0
- `rg 'export function aggregateProcessStatus' src/lib/pipeline-status.ts` returns a match
- `rg 'export function derivePipelineStatus' src/lib/pipeline-status.ts` returns a match
- `rg 'export function formatTime' src/lib/format.ts` returns a match
- `rg 'export function formatTimeWithSeconds' src/lib/format.ts` returns a match
- `rg 'export const STATUS_COLORS' src/lib/status.ts` returns a match
- `rg 'export function statusColor' src/lib/status.ts` returns a match

## Inputs

- `src/lib/format.ts` — existing shared format module to extend
- `src/lib/status.ts` — existing shared status module to extend
- `src/app/(dashboard)/pipelines/page.tsx` — reference implementation for `aggregateProcessStatus`
- `src/app/(dashboard)/page.tsx` — reference implementation for `derivePipelineStatus`
- `src/components/fleet/event-log.tsx` — reference implementation for `STATUS_COLORS`, `statusColor`, and HH:MM `formatTime`
- `src/components/fleet/node-logs.tsx` — reference implementation for HH:MM:SS `formatTime` variant
- `src/app/(dashboard)/audit/page.tsx` — reference for explicit-options `formatTimestamp`

## Expected Output

- `src/lib/pipeline-status.ts` — new shared module with `aggregateProcessStatus` and `derivePipelineStatus`
- `src/lib/format.ts` — extended with `formatTime`, `formatTimeWithSeconds`, and updated `formatTimestamp`
- `src/lib/status.ts` — extended with `STATUS_COLORS` and `statusColor`
