---
phase: 11-compliance-tags-rename
plan: "01"
subsystem: ui-text
tags: [rename, compliance-tags, ux-polish]
dependency_graph:
  requires: []
  provides: [compliance-tags-rename]
  affects: [team-settings, pipeline-settings, public-docs]
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - src/app/(dashboard)/settings/_components/team-settings.tsx
    - src/components/flow/pipeline-settings.tsx
    - src/lib/badge-variants.ts
    - prisma/schema.prisma
    - docs/public/user-guide/pipelines.md
    - docs/public/user-guide/pipeline-editor.md
decisions: []
metrics:
  duration: "~2min"
  completed: "2026-03-27T16:21:42Z"
  tasks_completed: 2
  files_modified: 6
requirements: [NAME-01]
---

# Phase 11 Plan 01: Compliance Tags Rename Summary

**One-liner:** Renamed "Data Classification Tags" and "Classification Tags" to "Compliance Tags" across source code, schema comments, and public docs to eliminate naming confusion with node Labels.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rename classification references in source code and schema | d369e05 | team-settings.tsx, pipeline-settings.tsx, badge-variants.ts, schema.prisma |
| 2 | Rename classification references in public docs | 3a0d097 | pipelines.md, pipeline-editor.md |

## What Was Done

### Task 1 - Source code and schema
- `team-settings.tsx`: Updated `// Data classification tags` comment to `// Compliance tags`, CardTitle from "Data Classification Tags" to "Compliance Tags", and description to reference "compliance tags"
- `pipeline-settings.tsx`: Updated `{/* Classification Tags */}` comment and `<Label>` text to "Compliance Tags"
- `badge-variants.ts`: Updated file-level JSDoc from "classification, status..." to "compliance, status..." and function JSDoc from "Classification tag colors" to "Compliance tag colors"
- `prisma/schema.prisma`: Updated two inline comments (Team.availableTags and Pipeline.tags) from "classification tags" to "compliance tags"

### Task 2 - Public documentation
- `docs/public/user-guide/pipelines.md`: Updated section heading from `## Data classification tags` to `## Compliance tags`, opening sentence, step referencing "Data Classification Tags" card, and step referencing "Classification Tags" section
- `docs/public/user-guide/pipeline-editor.md`: Updated settings panel description from "Classification Tags -- Assign data classification labels" to "Compliance Tags -- Assign compliance labels"

## Verification

Final sweep across src/, docs/public/, and prisma/schema.prisma returned zero matches for "Classification Tag" or "Data Classification" in any .tsx, .ts, or .md file.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- [x] All 6 files modified as planned
- [x] Task 1 commit d369e05 exists
- [x] Task 2 commit 3a0d097 exists
- [x] Zero "Classification Tag" remnants in modified files
- [x] "Compliance Tags" appears in team settings heading, pipeline settings label, and both doc pages
