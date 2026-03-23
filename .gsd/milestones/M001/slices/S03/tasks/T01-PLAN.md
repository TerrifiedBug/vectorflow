---
estimated_steps: 3
estimated_files: 2
skills_used: []
---

# T01: Create shared EmptyState and QueryError components

**Slice:** S03 — UI Consistency Sweep
**Milestone:** M001

## Description

Create two shared React components that will be used across all dashboard pages to replace inline patterns:
1. `EmptyState` — replaces the inline `border-dashed` empty state pattern used in 16+ files
2. `QueryError` — inline error display for failed tRPC queries (nothing like this exists yet)

Both must be thin wrappers matching existing visual patterns. No new dependencies.

## Steps

1. **Create `src/components/empty-state.tsx`** with these props:
   - `icon?: LucideIcon` — optional icon component (from lucide-react), rendered at `h-10 w-10 text-muted-foreground mb-3`
   - `title: string` — main message, rendered as `<p className="text-muted-foreground">{title}</p>`
   - `description?: string` — optional secondary text, rendered as `<p className="mt-2 text-xs text-muted-foreground">{description}</p>`
   - `action?: { label: string; href: string }` — optional CTA, rendered as `<Button asChild className="mt-4" variant="outline"><Link href={action.href}>{action.label}</Link></Button>`
   - `className?: string` — optional override classes merged via `cn()` with the base classes
   - The wrapper div base classes: `"flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center"`. When `className` is provided, merge it using `cn()` from `@/lib/utils` so callers can override padding (e.g. `className="p-8"` or `className="p-4 text-sm"`).
   - Export as named export: `export function EmptyState(...)`.
   - Import `type LucideIcon` from `lucide-react` for the icon prop type.

2. **Create `src/components/query-error.tsx`** with these props:
   - `message?: string` — error message (default: `"Failed to load data"`)
   - `onRetry?: () => void` — callback for retry button (typically `query.refetch`)
   - Use `AlertTriangle` icon from `lucide-react` (matches `ErrorBoundary` visual language in `src/components/error-boundary.tsx`).
   - Wrapper div: `"flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center"` (same as EmptyState).
   - Inside: `AlertTriangle` at `h-10 w-10 text-destructive mb-3`, message as `<p className="text-muted-foreground">`, retry button as `<Button variant="outline" className="mt-4" onClick={onRetry}>Try again</Button>` (only render button when `onRetry` is provided).
   - Export as named export: `export function QueryError(...)`.

3. **Verify** both components compile: run `pnpm exec tsc --noEmit`.

## Must-Haves

- [ ] `EmptyState` accepts icon, title, description, action, and className props
- [ ] `EmptyState` base classes match the existing `border-dashed p-12` pattern; className overrides via `cn()`
- [ ] `QueryError` accepts message and onRetry props, uses AlertTriangle icon with `text-destructive`
- [ ] Both use only existing imports: `lucide-react`, `@/components/ui/button`, `next/link`, `@/lib/utils`
- [ ] `pnpm exec tsc --noEmit` exits 0

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `test -f src/components/empty-state.tsx && test -f src/components/query-error.tsx`
- `rg 'export function EmptyState' src/components/empty-state.tsx`
- `rg 'export function QueryError' src/components/query-error.tsx`

## Inputs

- `src/components/error-boundary.tsx` — visual language reference (AlertTriangle, destructive color, retry pattern)
- `src/components/ui/button.tsx` — existing Button component
- `src/lib/utils.ts` — `cn()` utility for className merging

## Expected Output

- `src/components/empty-state.tsx` — new shared EmptyState component
- `src/components/query-error.tsx` — new shared QueryError component
