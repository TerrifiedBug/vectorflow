# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D001 | M001/S04 | arch | Test framework for Next.js + tRPC + Prisma codebase | Vitest — to be set up in S04 | Standard choice for Next.js projects, fast, good TypeScript support, compatible with tRPC testing patterns | Yes — if Vitest proves incompatible with the codebase | agent |
| D002 | M001 | arch | Refactoring depth for baseline quality milestone | Moderate — split files over ~800 lines, extract duplicates, move inline logic to services; don't restructure entire module tree | User confirmed moderate approach — split worst offenders without deep restructuring. Keeps scope bounded. | No | collaborative |
| D003 | M001/S02 | convention | Whether purely declarative data files (vrl/function-registry.ts) count against the file size target | Exempt from ~800-line target | function-registry.ts is 1775 lines of structured data definitions, not logic. Splitting it would add indirection without improving maintainability. | Yes — if the file gains logic beyond data definitions | agent |
