# Platform Improvements Round 2 — Design

**Goal:** Six quality-of-life improvements covering templates, auditing, team UX, per-environment credentials, and template page cleanup.

**Architecture:** All changes are additive schema changes + UI updates. One migration covers all DB changes. No new services or integrations.

---

## 1. Remove Built-In Templates

Delete `src/lib/vector/builtin-templates.ts`. Remove all references in the templates router that merge hardcoded templates into query results. Template page shows only user-created templates. Remove `isBuiltin` flag logic from router and UI.

## 2. Pipeline "Last Updated By"

Add `updatedById String?` (FK to User) to the Pipeline model. Pipeline save/update endpoints set this to the authenticated user. Pipeline list and detail pages display "Last updated by {name}" alongside the existing `updatedAt` timestamp.

## 3. Team Page: Local vs SSO Indicator

The `authMethod` enum (LOCAL, OIDC, BOTH) already exists on the User model. Add `authMethod` to the `team.get` query's user select clause. Display a badge next to each member in the team table: "Local", "SSO", or "Both".

## 4. Richer Audit Logs

Add to the AuditLog model:
- `ipAddress String?` — extracted from `x-forwarded-for` header or request socket
- `userEmail String?` — denormalized from User at write time
- `userName String?` — denormalized from User at write time

Update the audit middleware to capture IP and user details from tRPC context. Update the audit page table to display IP, username, and email as columns.

## 5. Per-Environment Git Credentials

Move git credentials from global SystemSettings to per-environment:

**Add to Environment model:**
- `gitSshKey Bytes?`
- `gitHttpsToken String?`
- `gitCommitAuthor String?`

**Remove from SystemSettings:**
- `gitopsSshKey`
- `gitopsHttpsToken`
- `gitopsCommitAuthor`

**UI changes:**
- Remove GitOps credential section from global Settings page
- Add SSH key upload + HTTPS token input to Environment create/edit forms
- Deploy router reads credentials from the pipeline's environment instead of SystemSettings

## 6. Remove Target Environment from Templates

Remove the environment Select dropdown from the templates page. When "Use Template" is clicked, the pipeline is created in the currently selected global environment (from the header `EnvironmentSelector` component / zustand store).
