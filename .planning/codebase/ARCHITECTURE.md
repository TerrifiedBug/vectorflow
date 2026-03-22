# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Full-stack Next.js application using tRPC for type-safe client-server communication. Follows a monolithic architecture with clear separation between:
- **Frontend:** Next.js App Router with React components
- **API Layer:** tRPC routers exposing procedures grouped by domain
- **Business Logic:** Server services handling cross-cutting concerns
- **Data Layer:** Prisma ORM with PostgreSQL

**Key Characteristics:**
- Type-safe end-to-end communication via tRPC (TypeScript definitions shared between client and server)
- Team-scoped authorization middleware (`withTeamAccess`) resolving permissions from database state
- Client-side state management via Zustand for editor state and local UI state
- Server-side state management via Prisma for persistent data
- Node-based visual pipeline editor using @xyflow/react

## Layers

**Frontend (Client):**
- Purpose: Next.js pages, React components, forms, visual editors
- Location: `src/app/` (pages), `src/components/` (reusable components)
- Contains: Page components, feature-specific component folders, UI primitives
- Depends on: tRPC client, React Query, Zustand stores, hooks
- Used by: End users via browser

**API Layer (tRPC Routers):**
- Purpose: Expose typed RPC procedures; handle authentication and authorization
- Location: `src/server/routers/` (one file per domain)
- Contains: `router()` definitions with `protectedProcedure`, `publicProcedure`, input validation (zod), middleware chaining
- Depends on: tRPC init setup, services, middleware, Prisma
- Used by: Frontend client via tRPC client

**Business Logic (Services):**
- Purpose: Core logic isolated from API layer; reusable across procedures
- Location: `src/server/services/` (utilities, generators, orchestrators)
- Contains: Config generation, validation, encryption, deployment, metrics ingestion, AI processing, audit logging
- Depends on: Prisma, external APIs (Vector GraphQL, AI providers)
- Used by: Routers, other services

**Middleware (Cross-Cutting):**
- Purpose: Apply concerns to procedures: authorization, audit logging, CSRF
- Location: `src/server/middleware/`
- Contains: Authorization (`withTeamAccess`, `requireRole`, `requireSuperAdmin`), audit logging (`withAudit`)
- Depends on: Prisma, context
- Used by: Routers

**Data Layer (Prisma):**
- Purpose: Object-relational mapping for PostgreSQL
- Location: `prisma/schema.prisma` (defines models); `src/generated/prisma/` (generated client)
- Contains: Models (User, Team, Pipeline, Environment, VectorNode, etc.), migrations
- Depends on: PostgreSQL
- Used by: All layers

**Client State (Zustand):**
- Purpose: Non-persistent UI state for editor, selections, UI preferences
- Location: `src/stores/` (flow-store.ts, environment-store.ts, team-store.ts)
- Contains: Node/edge history, undo/redo, clipboard, current selections
- Depends on: React, @xyflow/react
- Used by: Page components and feature components

**Library/Utilities:**
- Purpose: Shared logic not tied to any domain
- Location: `src/lib/` (config generators, formatters, Vector component schemas)
- Contains: YAML/TOML generation, Vector catalog, VRL function registry, type formatters, logger
- Depends on: No Prisma, no domain routers (stateless)
- Used by: Services, components, any layer

## Data Flow

**Pipeline Deployment Flow:**

1. **UI:** User edits pipeline in visual editor (flow-store manages nodes/edges)
2. **Client:** User clicks "Deploy" → calls `deploy.execute` tRPC procedure with pipelineId
3. **Router:** `deploy.ts:execute` procedure (`withTeamAccess("EDITOR")`) validates team access
4. **Service:** Calls `deployAgent(nodeId, configYaml)` → connects to Vector agent via push registry
5. **Service:** Calls `generateVectorYaml()` → converts node/edge graph to Vector TOML
6. **Service:** Calls `validateConfig(configYaml)` → validates against Vector schema via GraphQL
7. **Audit:** `withAudit` middleware logs deployment request before execution
8. **Response:** Returns status to client; client subscribes to `fleet.getStatusTimeline` for deployment progress
9. **Agent:** Vector agent receives config push via WebSocket (push registry), applies config

**Data Fetch Flow (Example: Pipelines List):**

1. **UI:** Page component uses `useQuery(["pipelines"])` from React Query
2. **tRPC Client:** Client intercepts and calls `pipeline.list` tRPC procedure
3. **HTTP:** Request sent to `/api/trpc/[trpc]` with batch link, includes x-trpc-source header (CSRF)
4. **Router:** `pipeline.ts:list` procedure (`withTeamAccess("VIEWER")`) resolves teamId from context
5. **Middleware:** `withTeamAccess` queries database to validate user is team member with VIEWER+ role
6. **Service:** Queries `prisma.pipeline.findMany()` with filters and includes
7. **Response:** serialized via superjson, returned as streamed JSON to client
8. **UI:** React Query caches result, re-renders component with pipelines

**Authentication & Authorization Flow:**

1. **Initial:** User submits login form → calls `/api/auth/callback/credentials` (NextAuth)
2. **Session:** NextAuth creates JWT session, stored in secure httpOnly cookie
3. **Per Request:** `createContext` in `trpc/init.ts` reads session via `auth()` (NextAuth)
4. **Per Procedure:** Middleware checks `ctx.session?.user` exists; throws UNAUTHORIZED if missing
5. **Team Check:** `withTeamAccess` middleware parses input to resolve teamId, queries database for membership and role
6. **Execution:** Only executes if user has required role in target team (or is superAdmin)

**State Management:**

- **Persistent State:** User, Team, Pipeline, Environment → Prisma → PostgreSQL
- **Session State:** Authentication token → NextAuth JWT in cookie
- **UI State (Transient):** Editor nodes/edges, selections, UI preferences → Zustand stores (memory)
- **Metrics State:** Event samples, pipeline metrics → MetricStore (in-memory cache) + Prisma for persistence
- **Configuration State:** Node configs stored encrypted in database (`config-crypto.ts` handles encryption)

## Key Abstractions

**Component Definition:**
- Purpose: Represents a Vector component (source, transform, sink) with schema and metadata
- Examples: `src/lib/vector/types.ts` (`VectorComponentDef`), `src/lib/vector/catalog.ts`
- Pattern: Immutable definitions fetched from Vector's official component catalog, indexed for UI autocomplete

**Pipeline Graph:**
- Purpose: Represents a directed acyclic graph of Vector components and data flows
- Examples: `src/stores/flow-store.ts` (runtime), `prisma/schema.prisma` (Pipeline + Node + Edge models)
- Pattern: Nodes (components + config), Edges (data flows); supports disabled state, position metadata

**Team Scope:**
- Purpose: Enforce multi-tenancy — all resources belong to a team; users have role per team
- Examples: `src/trpc/init.ts` (`withTeamAccess`), `prisma/schema.prisma` (Team model)
- Pattern: Middleware resolves teamId from input or entity lookups; queries database for membership; throws FORBIDDEN if not member

**Config Encryption:**
- Purpose: Encrypt sensitive node configs (API keys, passwords) at rest in database
- Examples: `src/server/services/config-crypto.ts`
- Pattern: Symmetric encryption per component type; keys stored in environment variable; called during deployment

**Deployment Request:**
- Purpose: Atomic unit of work for pushing config to agents, with versioning and approval workflow
- Examples: `prisma/schema.prisma` (DeployRequest model), `src/server/routers/deploy.ts`
- Pattern: Create DeployRequest, optionally require approval, execute to push agents, track status

**AI Conversation:**
- Purpose: Chat interface for AI suggestions within pipeline editor or VRL editor
- Examples: `prisma/schema.prisma` (AiConversation, AiMessage), `src/server/routers/ai.ts`
- Pattern: Conversation per pipeline/component; messages contain suggestions; suggestions applied via applier service

## Entry Points

**Web UI:**
- Location: `src/app/layout.tsx` (root) → `src/app/(dashboard)/layout.tsx` → feature pages
- Triggers: User navigates in browser; Next.js App Router matches URL to page
- Responsibilities: Render layout, set up providers (theme, auth, tRPC), display dashboard or auth pages

**API (tRPC):**
- Location: `src/app/api/trpc/[trpc]/route.ts`
- Triggers: POST/GET to `/api/trpc?batch=1&input=...` from tRPC client
- Responsibilities: Deserialize batch request, route to procedure, execute with context, serialize response

**Agent Enrollment:**
- Location: `src/app/api/agent/enroll/route.ts`
- Triggers: POST from Vector agent with enrollment token
- Responsibilities: Create VectorNode record, generate agent auth token, return config URL

**Agent Config Push:**
- Location: `src/app/api/agent/config/route.ts`
- Triggers: Vector agent long-polls for config updates
- Responsibilities: Return latest deployment config or null; block until config change

**Agent Event Ingestion:**
- Location: `src/app/api/agent/samples/route.ts`
- Triggers: POST from agent with metric/event samples
- Responsibilities: Parse samples, store in MetricStore, update PipelineStatus records

**Webhook Ingestion (External):**
- Location: `src/app/api/fleet/events/route.ts` (agent lifecycle), `src/app/api/webhooks/git/route.ts` (git sync)
- Triggers: External systems POST to these endpoints
- Responsibilities: Validate secret, ingest event, trigger side effects (alerts, deployments)

## Error Handling

**Strategy:** Typed error propagation via tRPC; explicit validation at procedure boundaries

**Patterns:**
- **Input Validation:** Zod schemas in procedure definitions; validation failures throw INVALID_INPUT before execution
- **Authorization Errors:** Middleware throws UNAUTHORIZED (no session) or FORBIDDEN (insufficient role)
- **Not Found:** Service throws NOT_FOUND for missing entities
- **Business Logic Errors:** Service throws BAD_REQUEST with descriptive message
- **Database Errors:** Prisma errors propagate (constraint violations, etc.); optionally caught and converted to tRPC errors
- **External API Errors:** Caught by service, converted to tRPC errors (e.g., Vector validation errors)
- **Client Handling:** tRPC client receives error object; pages display toast or error UI via `react-hot-toast` or `sonner`

## Cross-Cutting Concerns

**Logging:**
- Approach: Console logging in development (`src/lib/logger.ts`), structured logs in production
- Audit logging: `withAudit` middleware captures procedure names, user ID, resource IDs; `writeAuditLog` stores to AuditLog table

**Validation:**
- Procedure input validation via Zod schemas (declarative)
- Config validation against Vector schema via GraphQL query (`vector-graphql.ts`)
- Node config encryption/decryption via `config-crypto.ts`

**Authentication:**
- NextAuth v5 with JWT session strategy
- Pages redirect unauthenticated users to `/login`
- API procedures require `protectedProcedure` (checks session exists)
- Service endpoints (agent, REST API v1) use Bearer token auth via middleware

**Team Access Control:**
- `withTeamAccess` middleware resolves teamId and checks user has required role in team
- Super admins bypass team membership checks
- Supports fallback resolution: direct input, parent entity (environment → pipeline), association lookups

---

*Architecture analysis: 2026-03-22*
