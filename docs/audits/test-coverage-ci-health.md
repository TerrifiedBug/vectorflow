# Test Coverage & CI Health Audit

**Date:** 2026-04-06
**Ticket:** V-15
**Scope:** `src/` unit tests, `e2e/` Playwright tests, `agent/` Go tests, CI workflows, linting/formatting

---

## Summary

| Area | Status |
|---|---|
| TypeScript unit tests | 234 test files (Vitest) — good coverage |
| Go agent tests | 9 test files — **not run in CI** |
| E2E tests | 10 Playwright specs — **only on release tags** |
| Coverage reporting | **Not configured** |
| Go linting | **Not configured** |
| Prettier | **Not configured** |

---

## Critical

### 1. Go Agent Tests Not Run in CI

`ci.yml` — the `check` job runs `pnpm test` only. `go test ./...` appears solely in the PR checklist template (`PULL_REQUEST_TEMPLATE.md:21`) as a manually-ticked checkbox. Agent regressions pass CI undetected.

**Fix:** Add to `check` job in `ci.yml`:
```yaml
- name: Test agent
  working-directory: agent
  run: go test ./...
```

### 2. Coverage Thresholds Not Enforced

`vitest.config.ts` has no `coverage` block. The PR template line 23 says *"Coverage did not drop below 80%"* — this is unverifiable with the current config.

**Fix:** Add to `vitest.config.ts`:
```ts
coverage: {
  provider: "v8",
  thresholds: { lines: 80, functions: 80, branches: 70 },
  reporter: ["text", "lcov"],
}
```
Update CI step: `pnpm test --coverage`.

---

## High

### 3. E2E Tests Only Run on Version Tags

`e2e.yml` triggers: `push: tags: ["v*"]` and `workflow_dispatch` only. PRs and `main` merges skip E2E entirely.

**Fix:** Add `pull_request: branches: [main]` trigger with path filters.

### 4. No Go Linting in CI

No `golangci-lint`, `go vet`, or `gofmt -l` in CI. No `.golangci.yml` exists.

**Fix:** Add at minimum:
```yaml
- name: Vet agent
  working-directory: agent
  run: go vet ./...
```

---

## Medium

### 5. Three Go Packages Completely Untested

| Package | File |
|---|---|
| `agent/internal/client` | `client.go` — HTTP client for all agent→server calls |
| `agent/internal/logbuf` | `ringbuffer.go` |
| `agent/internal/metrics` | `scraper.go` |

### 6. Four Go Source Files Without Tests

| File | Lines | Notes |
|---|---|---|
| `agent/internal/agent/detect_labels.go` | 250 | Largest untested file |
| `agent/internal/agent/updater.go` | 101 | Self-update logic — high risk |
| `agent/internal/agent/enrollment.go` | 78 | Agent enrollment flow |
| `agent/internal/agent/detect.go` | 24 | OS/env detection |

---

## Low

### 7. One Skipped Unit Test (Documented)

`src/server/services/__tests__/leader-guard.test.ts:156` — `it.skip(...)` with documented reason: vitest fake timers cannot flush async `import()`. Covered by integration tests. Low risk.

### 8. DLP VRL Integration Tests Silently Skip in CI

`src/server/services/__tests__/dlp-vrl-integration.test.ts` uses `describe.skipIf(!hasVector)`. `vector` binary is not installed in CI, so the entire block silently skips.

**Fix:** Install `vector` in CI or add an explicit CI note/warning.

### 9. Accessibility Tests Use Synthetic HTML

`src/__tests__/accessibility.test.tsx` tests hand-written HTML snippets, not actual app components. Axe-core checks pass trivially. Real a11y regressions in components like `<Sidebar />` or `<DeployDialog />` would not be caught.

### 10. No Prettier Configuration

No `.prettierrc` or `prettier.config.*` found. ESLint-only formatting enforcement without auto-formatting.

### 11. CI Permissions Overly Broad

`ci.yml` sets `contents: write; packages: write` at workflow level. The `check` job needs only `contents: read`.

### 12. `anchore/sbom-action@v0` Unpinned

`ci.yml:67` uses `@v0` (floating tag). Pin to a specific release for supply-chain safety.

---

## What's Working Well

- **Strong TypeScript test breadth:** 234 test files spanning API routes, services, routers, hooks, components, and AI modules with consistent organisation.
- **E2E page-object model:** Well-structured with fixtures, page objects, and helper utilities.
- **CodeQL scanning:** JavaScript/TypeScript and Go on schedule + PRs.
- **Dependency audit:** `pnpm audit --audit-level high` with a tracked ignore list.
- **Per-file jsdom environment:** `accessibility.test.tsx` correctly uses `@vitest-environment jsdom` pragma.

---

## Recommended Priority Order

1. Add `go test ./...` to CI `check` job
2. Configure coverage in `vitest.config.ts` and enforce in CI
3. Add `go vet ./...` to CI
4. Add E2E trigger on PRs
5. Write tests for `detect_labels.go` and `updater.go`
6. Install Vector in CI or document the VRL skip gap
