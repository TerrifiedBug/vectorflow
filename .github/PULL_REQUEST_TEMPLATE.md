## Summary

<!-- Describe what this PR does and why. Link the issue it resolves. -->

Resolves #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] CI / tooling
- [ ] Other: ___

## Testing checklist

- [ ] `pnpm test` passes
- [ ] `npx tsc --noEmit` passes (no type errors)
- [ ] `pnpm lint` passes (no lint warnings)
- [ ] `cd agent && go test ./...` passes (if agent code changed)
- [ ] New or changed behaviour has test coverage
- [ ] Coverage did not drop below 80%

## Prisma migration checklist

Required when this PR changes `prisma/schema.prisma` or `prisma/migrations/**`.

- [ ] Backfill or data migration plan is documented, or confirmed not needed.
- [ ] Index impact is reviewed for new queries, changed filters, and high-churn tables.
- [ ] TimescaleDB compatibility is reviewed for hypertables, compression, continuous aggregates, and plain PostgreSQL fallback.
- [ ] Rollback plan is documented, including any manual SQL or data restoration steps.

## UI changes

<!-- Attach screenshots or a short recording if this changes the UI. Delete if not applicable. -->

## Documentation

- [ ] No user-facing changes
- [ ] Updated `docs/public/` for user-facing changes
- [ ] Added inline code comments where logic is non-obvious
