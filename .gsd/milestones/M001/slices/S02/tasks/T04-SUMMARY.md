---
id: T04
parent: S02
milestone: M001
provides:
  - team-member-dialogs.tsx with ResetPasswordDialog, LockUnlockDialog, LinkToOidcDialog, RemoveMemberDialog
  - user-management-dialogs.tsx with AssignToTeamDialog, UserLockUnlockDialog, DeleteUserDialog, CreateUserDialog, UserResetPasswordDialog, PasswordDisplayDialog
  - team-settings.tsx slimmed from 865 to 747 lines
  - users-settings.tsx slimmed from 813 to 522 lines
key_files:
  - src/app/(dashboard)/settings/_components/team-member-dialogs.tsx
  - src/app/(dashboard)/settings/_components/user-management-dialogs.tsx
  - src/app/(dashboard)/settings/_components/team-settings.tsx
  - src/app/(dashboard)/settings/_components/users-settings.tsx
key_decisions:
  - CreateUserDialog manages its own form state internally rather than parent-controlled state, eliminating 4 useState variables from the parent
  - ConfirmDialog usages (remove from team, toggle super admin) kept inline in users-settings as they are already concise single-component calls
patterns_established:
  - Dialog extraction pattern: each dialog receives open state (member/user object or null), onClose callback, isPending boolean, and an onConfirm callback. The parent retains mutation hooks and passes them as callbacks.
observability_surfaces:
  - none — pure structural refactor with no new runtime signals
duration: 12m
verification_result: passed
completed_at: 2026-03-23
blocker_discovered: false
---

# T04: Extract settings dialog sub-components

**Extracted 4 dialogs from team-settings.tsx and 6 dialogs from users-settings.tsx into sibling files, bringing both under 800-line target with clean tsc/eslint**

## What Happened

Extracted inline dialog components from two over-target settings files:

**team-settings.tsx (865 → 747 lines):** Moved 4 dialog components (ResetPasswordDialog, LockUnlockDialog, LinkToOidcDialog, RemoveMemberDialog) into `team-member-dialogs.tsx`. Each dialog accepts its member data, callbacks, and loading state as typed props. The parent retains all mutation hooks and passes them as callbacks.

**users-settings.tsx (813 → 522 lines):** Moved 6 dialog components (AssignToTeamDialog, UserLockUnlockDialog, DeleteUserDialog, CreateUserDialog, UserResetPasswordDialog, PasswordDisplayDialog) into `user-management-dialogs.tsx`. The CreateUserDialog was designed to manage its own form state internally, which eliminated 4 unused parent `useState` hooks (`newUserEmail`, `newUserName`, `newUserTeamId`, `newUserRole`). Two ConfirmDialog usages (remove from team, toggle super admin) were already concise and remained inline.

Removed unused imports from both parent files (Dialog components, Copy icon, copyToClipboard utility, Loader2 icon, Input, Label, Select).

## Verification

All task and slice verification checks pass:

- `pnpm exec tsc --noEmit` → exit 0 (no type errors)
- `pnpm exec eslint src/` → exit 0 (no warnings or errors)
- `team-settings.tsx`: 747 lines (under 800 ✅)
- `users-settings.tsx`: 522 lines (under 800 ✅)
- `team-member-dialogs.tsx`: exists, 280 lines
- `user-management-dialogs.tsx`: exists, 514 lines
- No non-exempt file over ~800 lines in `find src` top-10 check
- `alerts/page.tsx`: 45 lines (under 200 ✅)
- `pipeline.ts`: 847 lines (under 850 ✅)
- `dashboard.ts`: 652 lines (under 850 ✅)
- All service files and component directories exist

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm exec tsc --noEmit` | 0 | ✅ pass | 3.0s |
| 2 | `pnpm exec eslint src/` | 0 | ✅ pass | 7.5s |
| 3 | `wc -l team-settings.tsx` (747) | 0 | ✅ pass | <1s |
| 4 | `wc -l users-settings.tsx` (522) | 0 | ✅ pass | <1s |
| 5 | `test -f team-member-dialogs.tsx` | 0 | ✅ pass | <1s |
| 6 | `test -f user-management-dialogs.tsx` | 0 | ✅ pass | <1s |
| 7 | `wc -l alerts/page.tsx` (45) | 0 | ✅ pass | <1s |
| 8 | `wc -l pipeline.ts` (847) | 0 | ✅ pass | <1s |
| 9 | `wc -l dashboard.ts` (652) | 0 | ✅ pass | <1s |
| 10 | `test -f pipeline-graph.ts` | 0 | ✅ pass | <1s |
| 11 | `test -f dashboard-data.ts` | 0 | ✅ pass | <1s |
| 12 | `test -d alerts/_components` | 0 | ✅ pass | <1s |
| 13 | `find src ... sort -rn head -10` (no non-exempt >800) | 0 | ✅ pass | <1s |
| 14 | `grep TRPCError pipeline-graph.ts` (15 matches) | 0 | ✅ pass | <1s |

## Diagnostics

This is a pure structural refactor with no new runtime signals. If a settings dialog breaks after this change, the error will surface as a React rendering error in the browser console. The dialog components remain in the same route (`/settings`) and use the same tRPC mutations — the mutation error toasts provide user-facing failure visibility.

## Deviations

- CreateUserDialog manages its own internal form state instead of the parent-controlled approach suggested in the plan. This eliminated 4 parent `useState` hooks and simplified the interface. The dialog resets its own state via its `onOpenChange` handler.
- The plan suggested 200-300 lines for extracted dialog files. `user-management-dialogs.tsx` is 514 lines because it contains 6 dialog components (the plan listed 6 dialogs to extract), each with explicit prop interfaces.

## Known Issues

None.

## Files Created/Modified

- `src/app/(dashboard)/settings/_components/team-member-dialogs.tsx` — **created**: 4 extracted dialog components (ResetPasswordDialog, LockUnlockDialog, LinkToOidcDialog, RemoveMemberDialog) with typed prop interfaces
- `src/app/(dashboard)/settings/_components/user-management-dialogs.tsx` — **created**: 6 extracted dialog components (AssignToTeamDialog, UserLockUnlockDialog, DeleteUserDialog, CreateUserDialog, UserResetPasswordDialog, PasswordDisplayDialog)
- `src/app/(dashboard)/settings/_components/team-settings.tsx` — **modified**: replaced inline dialogs with imported components, removed unused imports (865 → 747 lines)
- `src/app/(dashboard)/settings/_components/users-settings.tsx` — **modified**: replaced inline dialogs with imported components, removed unused state and imports (813 → 522 lines)
