# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**
- Components: `kebab-case.tsx` (e.g., `status-timeline.tsx`, `field-renderer.tsx`)
- Services/utilities: `kebab-case.ts` (e.g., `agent-auth.ts`, `git-sync.ts`, `config-crypto.ts`)
- Hooks: `use-kebab-case.ts` (e.g., `use-fleet-events.ts`, `use-ai-conversation.ts`, `use-mobile.ts`)
- Stores: `kebab-case.ts` (e.g., `team-store.ts`, `environment-store.ts`)
- Routers: `kebab-case.ts` (e.g., `fleet.ts`, `user.ts`, `secret.ts`)
- Index files (barrel exports): `index.ts` for grouping related exports
- Schema/type definition files: `kebab-case.ts` (e.g., `node-types.ts`, `source-output-schemas.ts`)

**Functions and Variables:**
- camelCase for all function declarations and variables (e.g., `generateId()`, `formatTime()`, `validateConfig()`)
- Single-word verbs preferred for action functions: `fetch`, `validate`, `sync`, `commit`
- Compound names use full context: `getStatusTimeline()`, `gitSyncCommitPipeline()`, `parseVectorErrors()`
- Helper functions prefixed with context when in shared modules: `toTitleCase()`, `toFilenameSlug()`, `isMultilineName()`
- Boolean predicates start with `is` or `has`: `isClean()`, `hasTeamAccess()`, `isMultilineName()`
- TRPC procedures named as verbs: `.query()`, `.mutation()`, `.list`, `.get`, `.getStatusTimeline`

**Types and Interfaces:**
- PascalCase for all types, interfaces, and enums
- Component prop interfaces suffix with `Props` (e.g., `StatusTimelineProps`, `FieldRendererProps`)
- Use `interface` for object shapes, `type` for unions and type aliases
- Database model names match Prisma schema (e.g., `VectorNode`, `User`, `Team`)
- Derived interface names combine entity + purpose (e.g., `VectorComponentMetrics`, `VectorHealthResult`, `GitSyncConfig`)
- Exported types prefixed with `export` at declaration

**Constants:**
- Local constants: camelCase (e.g., `rangeMs`, `tmpDir`, `tmpFile`)
- Maps and lookup tables: camelCase with semantic naming (e.g., `STATUS_COLORS`, `rangeMs`)
- Environment variables referenced as constants: SCREAMING_SNAKE_CASE (e.g., `NEXTAUTH_SECRET`)

## Code Style

**Formatting:**
- Tool: ESLint 9 with Next.js core web vitals config
- Config file: `eslint.config.mjs`
- Prettier is not explicitly configured in this codebase; ESLint handles linting
- Line length: No explicit limit enforced; files follow Next.js conventions

**Linting:**
- Config: `eslint.config.mjs` extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Global ignores: `.next/`, `out/`, `build/`, `next-env.d.ts`, `src/generated/**`
- Run linting: `pnpm lint`
- Next.js ESLint rules enforce core web vitals and React best practices

**Indentation and Spacing:**
- 2 spaces (inferred from project style)
- No trailing commas in object literals (not enforced but observed)
- Empty lines between logical sections in files (see `field-renderer.tsx` pattern)

## Import Organization

**Order:**
1. External third-party packages (React, Next.js, libraries)
2. Internal server packages (`@trpc`, `@prisma`)
3. Internal utilities and types from `@/` alias
4. Local relative imports (rare; mostly avoided in favor of absolute paths)

**Pattern:**
```typescript
import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TRPCError } from "@trpc/server";
import { useTRPC } from "@/trpc/client";
import { prisma } from "@/lib/prisma";
import { validateConfig } from "@/server/services/validator";
import { SecretPickerInput } from "./secret-picker-input";
```

**Path Aliases:**
- `@/*` resolves to `src/*` (defined in `tsconfig.json`)
- Always use `@/` prefix for imports from `src/` directory
- No relative `../` paths in most codebases; use absolute `@/` paths

**Grouped Imports:**
- Group by source (external, internal by layer)
- Destructure multiple items from same module
- Default imports on separate line from named imports

## Error Handling

**Patterns:**
- TRPC: Throw `TRPCError` with code and message (e.g., `NOT_FOUND`, `BAD_REQUEST`)
  ```typescript
  if (!node) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Node not found",
    });
  }
  ```
- Services: Use try/catch with typed error handling
  ```typescript
  try {
    // operation
  } catch (err: unknown) {
    const execErr = err as NodeJS.ErrnoException & { stdout?: string };
    // Handle specific error types
  } finally {
    // cleanup
  }
  ```
- GraphQL queries: Catch-all with boolean return (e.g., `queryHealth()` returns `{ healthy: false }` on error)
- Client-side (React): Use state for error tracking, set via try/catch in async operations
  ```typescript
  const [error, setError] = useState<string | null>(null);
  try {
    // async operation
  } catch (e) {
    setError(String(e));
  }
  ```
- Environment validation: Throw `Error` if critical env var missing
  ```typescript
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET environment variable is required but not set");
  }
  ```

## Logging

**Framework:** `console` (browser DevTools for client, Node console for server)

**Patterns:**
- No explicit logging library detected; uses browser/Node native console
- Implicit logging through error handling and TRPC error messages
- Audit trail via `withAudit` middleware for sensitive operations (e.g., `user.password_changed`)

**When to Log:**
- Server-side: Errors and exceptional conditions only (via TRPC or error response)
- Client-side: Debugging only; production code relies on error states
- Audit: Use `withAudit` middleware for security-sensitive mutations

## Comments

**When to Comment:**
- Describe *why*, not *what* the code does
- Use for non-obvious logic or business rules
- Mark workarounds and fallbacks explicitly

**JSDoc/TSDoc:**
- Used for exported functions and public APIs
- Format: Single-line comments for simple explanations
  ```typescript
  /** Generate a UUID, with fallback for non-secure (HTTP) contexts. */
  export function generateId(): string { ... }
  ```
- Multiline comments for complex functions
  ```typescript
  /**
   * Validate a Vector YAML config using the `vector validate` CLI.
   * The Vector binary must be available (it is embedded in the server Docker image).
   */
  export async function validateConfig(yamlContent: string): Promise<ValidationResult> { ... }
  ```
- Comments within functions use `//` for inline explanations

**Section Markers:**
- Use ASCII comment headers to separate major sections
  ```typescript
  /* ------------------------------------------------------------------ */
  /*  Types                                                              */
  /* ------------------------------------------------------------------ */
  ```

## Function Design

**Size:**
- Prefer functions under 50 lines
- Helper functions extracted when logic repeats or when section separators emerge
- Large mutations split into setup, mutation, error handling, and cleanup phases

**Parameters:**
- Destructure object parameters when multiple are needed
- Options objects for 3+ parameters
  ```typescript
  export interface UseAiConversationOptions {
    pipelineId: string;
    currentYaml?: string;
    environmentName?: string;
  }
  export function useAiConversation(options: UseAiConversationOptions) { ... }
  ```

**Return Values:**
- Explicit return types on all exported functions
- Void for operations with only side effects
- Objects with clear shape when returning multiple values
- TRPC procedures return serializable data (Prisma models, JSON objects)
- GraphQL query functions return typed interfaces defined at top of module

**Async/Await:**
- Preferred over `.then()` chains
- Used consistently in services and hooks
- Server-side (TRPC): All async operations awaited before returning

## Module Design

**Exports:**
- Named exports preferred for utilities and hooks
- Default export for React components
- Barrel files (`index.ts`) group related exports
  ```typescript
  export { generateVectorYaml } from "./yaml-generator";
  export { generateVectorToml } from "./toml-generator";
  export { importVectorConfig, type ImportResult } from "./importer";
  ```

**Barrel Files:**
- Located in `src/lib/config-generator/index.ts` to re-export submodules
- Used for public APIs to reduce import depth
- Not used for `.../src/components/ui` (each component imported directly)

**Layers:**
- `src/lib/` — Utilities, helpers, types, integrations (database, crypto, validation)
- `src/server/` — TRPC routers, middleware, services, database access
- `src/components/` — React components (UI, feature, domain-specific)
- `src/hooks/` — Custom React hooks with state and side effects
- `src/stores/` — Zustand stores for global state
- `src/trpc/` — TRPC client setup and type exports
- `src/app/` — Next.js pages and routes

**Conventions by Directory:**
- Services (`src/server/services/`) export pure functions, no default exports
- Routers (`src/server/routers/`) define router objects with procedures
- Stores (Zustand) export store hooks via `export const useXStore = create(...)`
- React components export function components with `export function XYZ()` or default
- Utilities in `src/lib/` group by domain (config-generator, vector, vrl, ai)

## Type Safety

**TypeScript Configuration:**
- Target: ES2017
- Strict mode: Enabled
- JSX: React 19 with JSX runtime
- Module resolution: Bundler (Next.js)
- Path alias: `@/*` → `src/*`

**Patterns:**
- Use `unknown` for caught errors, then cast/guard to specific type
- Type guards for discriminated unions (e.g., status checks)
- Optional chaining (`?.`) and nullish coalescing (`??`) preferred over ternaries for null checks
- Explicit `null` vs `undefined` — use null for intentional absence, undefined for unset values
- Export type declarations alongside value exports where relevant

---

*Convention analysis: 2026-03-22*
