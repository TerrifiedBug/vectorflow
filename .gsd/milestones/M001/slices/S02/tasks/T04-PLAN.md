---
estimated_steps: 4
estimated_files: 4
skills_used:
  - lint
  - review
---

# T04: Extract settings dialog sub-components

**Slice:** S02 — Router & Component Refactoring
**Milestone:** M001

## Description

`team-settings.tsx` (865 lines) and `users-settings.tsx` (813 lines) are slightly over the ~800-line target. Each contains a main component with a data table plus multiple inline dialog components (reset password, lock/unlock, remove member, etc.). Extracting the dialogs into sibling files brings both under target and completes R003 coverage for all non-exempt files.

**Risk note from research:** These components share many mutation hooks and state variables between the table and its dialogs. Extracting dialogs means threading 3-5 callbacks per dialog as props. If prop drilling makes a component harder to read than the current monolith, keep that dialog inline — the ~800 target is a guideline, not a hard line. Aim for each parent file in the 550-700 line range but prioritize readability.

## Steps

1. **Read both settings files** to identify which dialogs are most independent (least shared state) and which are tightly coupled to the parent. Prioritize extracting the most independent dialogs first. Check what mutation hooks, state variables, and callbacks each dialog uses.

2. **Extract team member dialogs** from `team-settings.tsx` into `team-member-dialogs.tsx`:
   - Identify dialogs: reset password dialog, lock/unlock confirmation, remove member confirmation, link to OIDC dialog.
   - Create a new file with these dialog components. Each accepts its needed data and callbacks as props (open state, onConfirm callback, member data, loading state).
   - Update `team-settings.tsx` to import and use the extracted dialogs.
   - Target: `team-settings.tsx` under 800 lines.

3. **Extract user management dialogs** from `users-settings.tsx` into `user-management-dialogs.tsx`:
   - Identify dialogs: assign to team, lock/unlock, reset password, delete user, create user, toggle super admin.
   - Same extraction pattern as step 2.
   - Target: `users-settings.tsx` under 800 lines.

4. **Verify** `tsc --noEmit` and `eslint src/` both pass. Check `wc -l` on both files.

## Must-Haves

- [ ] `team-settings.tsx` under 800 lines
- [ ] `users-settings.tsx` under 800 lines
- [ ] Extracted dialog components are properly typed with explicit prop interfaces
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm exec eslint src/` exits 0
- [ ] No changes to runtime behavior — same dialogs, same functionality

## Verification

- `pnpm exec tsc --noEmit` exits 0
- `pnpm exec eslint src/` exits 0
- `wc -l src/app/(dashboard)/settings/_components/team-settings.tsx` — under 800 lines
- `wc -l src/app/(dashboard)/settings/_components/users-settings.tsx` — under 800 lines
- `test -f src/app/(dashboard)/settings/_components/team-member-dialogs.tsx`
- `test -f src/app/(dashboard)/settings/_components/user-management-dialogs.tsx`

## Inputs

- `src/app/(dashboard)/settings/_components/team-settings.tsx` — 865-line source to split
- `src/app/(dashboard)/settings/_components/users-settings.tsx` — 813-line source to split

## Expected Output

- `src/app/(dashboard)/settings/_components/team-settings.tsx` — slimmed to ~550-700 lines
- `src/app/(dashboard)/settings/_components/users-settings.tsx` — slimmed to ~550-700 lines
- `src/app/(dashboard)/settings/_components/team-member-dialogs.tsx` — extracted dialog components (~200-300 lines)
- `src/app/(dashboard)/settings/_components/user-management-dialogs.tsx` — extracted dialog components (~200-300 lines)
