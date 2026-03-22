# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework

**Status:** No automated test framework configured

**Notable:**
- No test files found in codebase (`find` returned 0 results for `*.test.ts`, `*.spec.ts`)
- No jest.config.js, vitest.config.js, or test runner configuration
- No test dependencies in `package.json` (no jest, vitest, mocha, chai)
- No test scripts in package.json (no `test`, `test:watch`, `test:coverage`)

**Implication:** Testing strategy is manual or external (e.g., E2E tests via Cypress/Playwright, QA team testing). Feature work does not include unit test requirements.

## Testing Approach

**Current State:**
- Manual testing by developers
- Potential external E2E testing (not integrated into codebase)
- Type safety via TypeScript as primary quality gate

**Recommendations for Implementation:**
If automated testing is added, the following patterns should be adopted:

### Unit Test Setup (if adopting Vitest)

**Framework Choice:** Vitest recommended (faster, better TypeScript support for Next.js than Jest)

**Config Location:** `vitest.config.ts` in project root

**Basic Config:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
```

**Run Commands:**
```bash
pnpm test              # Run all tests once
pnpm test:watch       # Watch mode
pnpm test:coverage    # Coverage report
```

## Test File Organization

**Location Strategy (recommended):**
- Co-located with source code (same directory)
- Naming: `{component}.test.ts`, `{function}.spec.ts`

**Pattern:**
```
src/
  server/
    services/
      validator.ts
      validator.test.ts
    routers/
      fleet.ts
      fleet.test.ts
  components/
    fleet/
      status-timeline.tsx
      status-timeline.test.tsx
  lib/
    utils.ts
    utils.test.ts
```

**Why co-located:**
- Easy to find tests for a given file
- Tests moved/deleted with source
- Simpler import paths in tests

## Test Structure

**Suite Organization (recommended pattern):**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateConfig } from './validator';

describe('validateConfig', () => {
  describe('valid YAML', () => {
    it('returns { valid: true, errors: [], warnings: [] }', async () => {
      const result = await validateConfig('sources:\n  in:\n    type: stdin');
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid YAML', () => {
    it('parses error messages from Vector', async () => {
      const result = await validateConfig('invalid: [yaml');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('when Vector binary missing', () => {
    it('returns specific error', async () => {
      vi.spyOn(child_process, 'execFile').mockImplementation(() => {
        throw { code: 'ENOENT' };
      });
      const result = await validateConfig('sources: {}');
      expect(result.errors[0]?.message).toContain('Vector binary not found');
    });
  });
});
```

**Patterns:**
- Use `describe()` blocks to group related tests
- Nest `describe()` for different scenarios (valid input, invalid input, edge cases)
- One `it()` per assertion (each test verifies one behavior)
- Descriptive test names that read as sentences

## Mocking

**Framework:** Vitest built-in `vi` module

**Mocking Pattern:**
```typescript
import { vi } from 'vitest';

// Mock a module
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vectorNode: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// Mock a function
vi.spyOn(crypto, 'randomUUID').mockReturnValue('mocked-uuid');

// Mock with implementation
vi.spyOn(fetch).mockImplementation(() =>
  Promise.resolve(new Response(JSON.stringify({ data: {} })))
);
```

**What to Mock:**
- External APIs (GraphQL endpoints, HTTP calls)
- Database operations (Prisma queries)
- Crypto/random functions (for deterministic tests)
- File system operations (fs module)
- Async operations with side effects

**What NOT to Mock:**
- Utility functions (`utils.ts`, `crypto.ts`, `git-sync.ts` helpers)
- Type definitions and constants
- Core business logic (validate with real data when possible)
- Internal function calls within same module

**Pattern for Services with External Dependencies:**
```typescript
describe('authenticateAgent', () => {
  beforeEach(() => {
    vi.mock('@/lib/prisma');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns nodeId and environmentId when token matches', async () => {
    const mockPrisma = vi.mocked(prisma);
    mockPrisma.vectorNode.findMany.mockResolvedValue([
      { id: 'node-1', environmentId: 'env-1', nodeTokenHash: 'hash' },
    ]);

    const result = await authenticateAgent(mockRequest);
    expect(result).toEqual({ nodeId: 'node-1', environmentId: 'env-1' });
  });
});
```

## Fixtures and Factories

**Test Data Pattern (recommended):**

Create factories in `src/__tests__/fixtures/` directory:

```typescript
// src/__tests__/fixtures/vector-node.ts
export function createVectorNode(overrides = {}) {
  return {
    id: 'node-' + Math.random().toString(36).slice(2),
    environmentId: 'env-1',
    name: 'test-node',
    status: 'HEALTHY',
    lastSeen: new Date(),
    nodeTokenHash: null,
    ...overrides,
  };
}

// Usage in tests
it('lists nodes by environment', async () => {
  const nodes = [
    createVectorNode({ status: 'HEALTHY' }),
    createVectorNode({ status: 'DEGRADED' }),
  ];
  mockPrisma.vectorNode.findMany.mockResolvedValue(nodes);
  // ...
});
```

**Location:**
- `src/__tests__/fixtures/` for shared test data
- `src/__tests__/mocks/` for mock implementations
- Keep fixtures close to tests that use them

## Coverage

**Requirements:** Not enforced (no coverage threshold specified in codebase)

**If Coverage is Added:**

Add to `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/generated/**'],
      lines: 70,
      functions: 70,
      branches: 65,
    },
  },
});
```

**View Coverage:**
```bash
pnpm test:coverage
# Opens coverage/index.html
```

## Test Types

**Unit Tests:**
- Scope: Single function or component in isolation
- Approach: Mock all external dependencies
- Examples: `validateConfig()`, `authenticateAgent()`, `encrypt()`/`decrypt()`
- Location: Co-located with source file

**Integration Tests:**
- Scope: Multiple modules working together (e.g., TRPC procedure calling service)
- Approach: Mock database and external APIs, test flow through layers
- Examples: TRPC `fleet.list` calling `prisma.vectorNode.findMany()` and returning transformed data
- Pattern:
  ```typescript
  describe('fleetRouter.list integration', () => {
    it('fetches nodes and adds pushConnected status', async () => {
      mockPrisma.vectorNode.findMany.mockResolvedValue([...]);
      mockPushRegistry.isConnected.mockReturnValue(true);

      const result = await fleetRouter.createCaller({}).list({ environmentId: 'env-1' });
      expect(result[0]).toHaveProperty('pushConnected', true);
    });
  });
  ```

**E2E Tests:**
- Scope: Full user workflows via browser automation
- Framework: Playwright or Cypress (not currently in project)
- Approach: Run against running application with real database
- Would test: Login → Create Pipeline → Deploy → View Status

## Common Patterns

**Async Testing:**
```typescript
it('validates config asynchronously', async () => {
  const result = await validateConfig('sources: {}');
  expect(result).toBeDefined();
});

// With timeout for slow operations
it('handles long-running validation', async () => {
  const result = await validateConfig(largeYaml, { timeout: 5000 });
  expect(result.valid).toBe(true);
}, 10000); // Test timeout in ms
```

**Error Testing:**
```typescript
it('throws TRPCError when user not found', async () => {
  mockPrisma.user.findUnique.mockResolvedValue(null);

  await expect(() =>
    userRouter.changePassword({ currentPassword: '...', newPassword: '...' })
  ).rejects.toThrow(TRPCError);
});

it('returns specific error when Vector binary missing', async () => {
  vi.spyOn(execFileAsync).mockRejectedValue({ code: 'ENOENT' });

  const result = await validateConfig('test');
  expect(result.valid).toBe(false);
  expect(result.errors[0]?.message).toContain('Vector binary not found');
});
```

**Hook Testing (with vitest-react-hooks or similar):**
```typescript
import { renderHook, act } from '@testing-library/react-hooks';
import { useTeamStore } from '@/stores/team-store';

it('updates selected team', () => {
  const { result } = renderHook(() => useTeamStore());

  act(() => {
    result.current.setSelectedTeamId('team-1');
  });

  expect(result.current.selectedTeamId).toBe('team-1');
});
```

**Component Testing (with vitest + React Testing Library):**
```typescript
import { render, screen } from '@testing-library/react';
import { StatusTimeline } from './status-timeline';

it('renders time range selector', () => {
  render(<StatusTimeline nodeId="node-1" range="1h" onRangeChange={vi.fn()} />);
  expect(screen.getByText(/1h/i)).toBeInTheDocument();
});

it('calls onRangeChange when selection changes', async () => {
  const handleChange = vi.fn();
  const { user } = render(
    <StatusTimeline nodeId="node-1" range="1h" onRangeChange={handleChange} />
  );

  await user.selectOption(screen.getByRole('combobox'), '6h');
  expect(handleChange).toHaveBeenCalledWith('6h');
});
```

## Recommended Test Priority

If implementing tests, prioritize in this order:

1. **Services** (`src/server/services/`) — Pure functions with business logic
   - `validator.ts` (validates YAML configs)
   - `crypto.ts` (encryption/decryption)
   - `git-sync.ts` (Git operations)
   - `agent-auth.ts` (authentication logic)

2. **TRPC Routers** (`src/server/routers/`) — Request/response handling
   - Focus on error cases and authorization checks
   - Mock Prisma queries

3. **Utilities** (`src/lib/utils.ts`, config-generator) — Reusable helpers
   - Pure utility functions with predictable inputs/outputs

4. **Hooks** (`src/hooks/`) — State and side effects
   - Use vitest + React testing library
   - Mock TRPC calls

5. **Components** (`src/components/`) — UI layers (lower priority)
   - Focus on components with business logic
   - UI-only components can rely on manual testing

---

*Testing analysis: 2026-03-22*
