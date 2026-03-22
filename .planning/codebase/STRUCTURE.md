# Codebase Structure

**Analysis Date:** 2026-03-22

## Directory Layout

```
vectorflow/
├── src/                        # Main application source
│   ├── app/                    # Next.js App Router pages and API routes
│   ├── components/             # React components organized by feature
│   ├── generated/              # Auto-generated files (Prisma client)
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Shared utilities and logic
│   ├── server/                 # Backend services, routers, middleware
│   ├── stores/                 # Zustand client state stores
│   ├── trpc/                   # tRPC setup and configuration
│   ├── types/                  # TypeScript type definitions
│   ├── auth.config.ts          # NextAuth configuration
│
├── prisma/                     # Database schema and migrations
│   ├── schema.prisma           # Prisma data model
│   └── migrations/             # Database migration history
│
├── public/                     # Static assets (images, icons)
├── docs/                       # Documentation
│   ├── public/                 # User-facing docs (GitBook synced)
│   ├── plans/                  # Implementation plans (not committed)
│   └── superpowers/            # Internal design docs
│
├── docker/                     # Docker configurations for deployment
│   ├── agent/                  # Agent Docker setup
│   └── server/                 # Server Docker setup
│
├── scripts/                    # Utility scripts
├── agent/                      # Go-based agent (separate service)
├── assets/                     # Design assets
│
├── package.json                # pnpm dependencies
├── tsconfig.json               # TypeScript configuration
├── next.config.ts              # Next.js configuration
├── eslint.config.mjs           # ESLint configuration
└── tailwind.config.ts          # Tailwind CSS configuration
```

## Directory Purposes

**`src/app/`:**
- Purpose: Next.js App Router pages and API route handlers
- Contains: Page components (`.tsx`), API route handlers (`route.ts`), layouts
- Key files:
  - `src/app/layout.tsx`: Root layout (theme, auth, tRPC providers)
  - `src/app/(auth)/`: Auth group (login, 2FA setup)
  - `src/app/(dashboard)/`: Protected dashboard routes (pipelines, fleet, environments, etc.)
  - `src/app/api/`: API routes (tRPC, agent, webhooks, health)

**`src/components/`:**
- Purpose: Reusable React components organized by feature
- Contains: Feature-scoped folders + UI primitives
- Key subdirectories:
  - `src/components/ui/`: shadcn-based UI primitives (button, dialog, table, etc.)
  - `src/components/pipeline/`: Pipeline editor related components
  - `src/components/flow/`: Visual flow/graph components
  - `src/components/fleet/`: Vector fleet management UI
  - `src/components/vrl-editor/`: VRL syntax editor with Monaco
  - `src/components/deploy/`: Deployment workflow UI
  - `src/components/dashboard/`: Dashboard overview UI
  - `src/components/config-forms/`: Dynamic forms for component configuration
  - `src/components/metrics/`: Metrics visualization

**`src/server/`:**
- Purpose: Backend business logic
- Contains: tRPC routers, services, middleware, integrations
- Subdirectories:
  - `src/server/routers/`: tRPC router definitions (one per domain: pipeline, fleet, environment, etc.)
  - `src/server/services/`: Business logic modules (config generation, validation, encryption, deployment, metrics)
  - `src/server/middleware/`: tRPC middleware (authorization, audit)
  - `src/server/integrations/`: External API integrations (Vector GraphQL, AI providers)

**`src/lib/`:**
- Purpose: Shared utilities and domain-specific logic
- Contains: Stateless functions, constants, type definitions
- Subdirectories:
  - `src/lib/vector/`: Vector component definitions and catalog
  - `src/lib/ai/`: AI suggestion logic (prompts, validators, appliers)
  - `src/lib/config-generator/`: YAML/TOML generation for Vector configs
  - `src/lib/vrl/`: VRL language utilities (function registry, snippets)
- Key files:
  - `src/lib/prisma.ts`: Prisma client singleton
  - `src/lib/utils.ts`: String utilities, ID generation
  - `src/lib/format.ts`: Data formatting (bytes, rates, dates)
  - `src/lib/logger.ts`: Logging utility

**`src/stores/`:**
- Purpose: Zustand client-side state (non-persistent UI state)
- Contains: Store definitions with actions and selectors
- Key files:
  - `src/stores/flow-store.ts`: Pipeline editor state (nodes, edges, history, clipboard)
  - `src/stores/team-store.ts`: Current team selection
  - `src/stores/environment-store.ts`: Current environment selection

**`src/trpc/`:**
- Purpose: tRPC setup and configuration
- Key files:
  - `src/trpc/init.ts`: tRPC initialization, context, middleware definitions
  - `src/trpc/router.ts`: Main router aggregating all domain routers
  - `src/trpc/client.tsx`: tRPC client provider for React

**`src/hooks/`:**
- Purpose: Custom React hooks for shared stateful logic
- Key files:
  - `src/hooks/use-ai-conversation.ts`: Pipeline AI chat
  - `src/hooks/use-vrl-ai-conversation.ts`: VRL editor AI chat
  - `src/hooks/use-fleet-events.ts`: Real-time fleet event streaming

**`src/generated/`:**
- Purpose: Auto-generated code (DO NOT edit directly)
- Contains: Prisma client type definitions
- Notes: Regenerated via `pnpm postinstall` (prisma generate)

**`prisma/`:**
- Purpose: Database schema and migrations
- Key files:
  - `prisma/schema.prisma`: Data model definitions (User, Team, Pipeline, Environment, VectorNode, etc.)
  - `prisma/migrations/`: SQL migration files (one per schema change)
- Notes: Migrations tracked in git; run via `prisma migrate deploy` in production

**`public/`:**
- Purpose: Static assets served by Next.js
- Contains: Favicons, logos, default images

**`docs/public/`:**
- Purpose: User-facing documentation synced to GitBook
- Key pages:
  - `docs/public/user-guide/pipeline-editor.md`: Pipeline editor docs
  - `docs/public/user-guide/fleet.md`: Fleet management docs
  - `docs/public/operations/configuration.md`: Environment variables
  - `docs/public/operations/authentication.md`: Auth setup

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root layout with providers
- `src/app/(dashboard)/page.tsx`: Dashboard homepage
- `src/app/api/trpc/[trpc]/route.ts`: tRPC HTTP handler
- `src/app/api/health/route.ts`: Health check endpoint

**Configuration:**
- `src/auth.config.ts`: NextAuth provider setup
- `tsconfig.json`: TypeScript compiler options with `@/*` path alias
- `tailwind.config.ts`: Tailwind CSS theming
- `prisma/schema.prisma`: Database schema

**Core Logic:**
- `src/server/routers/`: Domain-specific API procedures (15+ routers)
- `src/server/services/`: Business logic modules (30+ services)
- `src/lib/config-generator/index.ts`: YAML generation pipeline
- `src/lib/vector/catalog.ts`: Vector component definitions

**Testing:**
- No test files present in src/ (testing pattern not detected)
- Integration testing would use tRPC client calls

## Naming Conventions

**Files:**
- `.tsx`: React components (default)
- `.ts`: TypeScript utilities, services, routers
- `[brackets].tsx`: Dynamic routes (Next.js)
- `(parentheses)/`: Route groups (Next.js) — no URL path

**Directories:**
- Plural names: `components/`, `stores/`, `services/`, `routers/`, `hooks/`
- Descriptive feature names: `pipeline/`, `fleet/`, `vrl-editor/`, `config-forms/`

**Functions & Variables:**
- camelCase: `createPipelineVersion()`, `withTeamAccess`, `flowStore`
- PascalCase: React components (`<PipelineEditor />`), types (`User`, `VectorComponentDef`)
- UPPERCASE: Constants (`MAX_HISTORY`, `AUDIT_LOG_PATH`)

**Database Models:**
- PascalCase: User, Team, Pipeline, Environment, VectorNode, AiConversation

**Zod Schemas:**
- camelCase with "Schema" suffix: `pipelineNameSchema`, `nodeSchema`, `edgeSchema`

## Where to Add New Code

**New Feature (e.g., "User Preferences"):**
- **Router:** `src/server/routers/user-preference.ts` (add to `src/trpc/router.ts`)
- **Page:** `src/app/(dashboard)/settings/preferences/page.tsx` (new route)
- **Components:** `src/components/preferences/` (feature-scoped folder)
- **Services:** `src/server/services/preferences.ts` (if complex logic)
- **Hooks:** `src/hooks/use-user-preferences.ts` (if shared state logic)
- **Schema:** Add model to `prisma/schema.prisma`, run `prisma migrate dev`

**New Component/Widget:**
- **Reusable UI:** `src/components/ui/my-component.tsx` (if primitive; use shadcn)
- **Feature Component:** `src/components/{feature}/MyComponent.tsx` (if scoped to feature)
- **Export:** Re-export from feature folder's index if multiple components

**New Utility/Helper:**
- **Shared logic:** `src/lib/my-utility.ts` (if domain-agnostic)
- **Domain-specific:** `src/lib/{domain}/my-utility.ts` (if scoped, e.g., `src/lib/vector/`)
- **Service logic:** `src/server/services/my-service.ts` (if database/side effects)

**New API Route (non-tRPC):**
- **Agent/Webhook:** `src/app/api/{service}/{endpoint}/route.ts`
- **Pattern:** Use middleware for auth, validate input, call service, return response

**New Middleware:**
- **File:** `src/server/middleware/{concern}.ts` (e.g., `rate-limit.ts`)
- **Pattern:** Export middleware function compatible with tRPC; use in router procedures via `.use()`

**New Page:**
- **Authenticated:** `src/app/(dashboard)/{feature}/page.tsx` (inside dashboard layout)
- **Public:** `src/app/{feature}/page.tsx` (top-level)
- **Auth:** `src/app/(auth)/{flow}/page.tsx` (e.g., login, setup)

## Special Directories

**`src/generated/`:**
- Purpose: Auto-generated Prisma client
- Generated: Yes (via `prisma generate`)
- Committed: No (excluded via `.gitignore` in typical setup; regenerated post-install)
- Notes: DO NOT edit; generated on `pnpm install`

**`prisma/migrations/`:**
- Purpose: Database migration history
- Generated: Yes (via `prisma migrate dev`)
- Committed: Yes (track schema evolution)
- Notes: Each migration is timestamped SQL file + metadata JSON

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes (via `pnpm build`)
- Committed: No (in `.gitignore`)
- Notes: Contains compiled pages, static assets, server bundles

**`docs/plans/`:**
- Purpose: Implementation plans for features
- Generated: No (manually created)
- Committed: No (in `.gitignore`)
- Notes: Ephemeral; deleted after implementation

**`docs/superpowers/`:**
- Purpose: Internal design specifications and brainstorms
- Generated: No (manually created)
- Committed: No (internal only)
- Notes: Research, architecture decisions, sketches

---

*Structure analysis: 2026-03-22*
