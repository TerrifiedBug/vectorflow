# VectorFlow — Design Document

**Date:** 2026-02-27
**Status:** Approved
**Author:** Danny + Claude

## Overview

VectorFlow is a full-lifecycle GUI management plane for [Vector](https://vector.dev) observability pipelines. It provides a visual flow builder for designing pipelines, fleet management for monitoring Vector nodes, and deployment tooling for pushing configs to production — all behind OIDC + local authentication with role-based access control and full audit logging.

Think of it as what [Chronosphere/Calyptia](https://chronosphere.io/platform/telemetry-pipeline/) built for Fluent Bit, but for Vector.

## Goals

- Make Vector pipeline creation accessible to a broad audience (junior devs to SREs)
- Provide full lifecycle management: design, validate, deploy, monitor, rollback
- Enterprise-ready from day one: OIDC, RBAC, audit logging, multi-environment
- Standalone web app that connects to existing Vector fleets via their GraphQL API

## Architecture

### Approach: Monolithic Next.js + Rust Validation Sidecar

A single Next.js application handles the UI, API, and business logic. A WASM-compiled Rust module provides config validation with guaranteed parity to Vector's native validation.

```
┌──────────────────────────────────────────────────────┐
│  VectorFlow (single Next.js app)                     │
│                                                      │
│  ┌─────────┐  ┌───────────┐  ┌────────┐ ┌────────┐  │
│  │ React   │  │ API Layer │  │ Auth   │ │Postgres│  │
│  │ Flow UI │  │ (tRPC)    │  │(Local +│ │(Prisma)│  │
│  │(client) │  │ (server)  │  │ OIDC)  │ │        │  │
│  └─────────┘  └───────────┘  └────────┘ └────────┘  │
│                    │                                 │
│  ┌─────────────────┴──────────────────┐              │
│  │ Vector Service Layer               │              │
│  │ - Fleet discovery & health polling │              │
│  │ - Config generation (YAML/TOML)    │              │
│  │ - GitOps integration               │              │
│  │ - Audit log writer                 │              │
│  └────────────┬───────────────────────┘              │
│               │                                      │
│  ┌────────────▼───────────┐                          │
│  │ Vector Validator (WASM)│                          │
│  └────────────────────────┘                          │
└──────────────────────────────────────────────────────┘
                       │ GraphQL + REST
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Vector   │ │ Vector   │ │ Vector   │
   │ Node 1   │ │ Node 2   │ │ Node N   │
   │ :8686    │ │ :8686    │ │ :8686    │
   └──────────┘ └──────────┘ └──────────┘
```

**Why this approach:**
- The management plane doesn't need Rust performance — it makes a handful of API calls and renders dashboards
- Next.js gives 3-5x faster iteration on UI-heavy features (forms, drag-and-drop, real-time dashboards)
- The WASM validator ensures config validation parity without reimplementing Vector's logic in TypeScript
- Single deployable Docker image — simple to operate

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 19, React Flow (xyflow), shadcn/ui, Tailwind CSS |
| API | tRPC (type-safe end-to-end) |
| State | Zustand (flow builder state) |
| Database | PostgreSQL via Prisma |
| Auth | NextAuth.js v5 (Local + OIDC) |
| VRL Editor | Monaco Editor |
| Validation | Vector WASM validator |
| Deployment | Docker + docker-compose |

### Project Structure

```
vectorflow/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (auth)/             # Login, callback, setup wizard
│   │   ├── (dashboard)/        # Main app layout
│   │   │   ├── pipelines/      # Pipeline list, builder
│   │   │   ├── fleet/          # Node management
│   │   │   ├── environments/   # Dev/staging/prod
│   │   │   ├── templates/      # Blueprint library
│   │   │   ├── audit/          # Audit log viewer
│   │   │   └── settings/       # OIDC, fleet, GitOps, RBAC
│   │   └── api/trpc/           # tRPC API handler
│   ├── components/
│   │   ├── flow/               # React Flow nodes, edges, toolbar
│   │   ├── config-forms/       # Auto-generated component config forms
│   │   ├── vrl-editor/         # Monaco-based VRL playground
│   │   └── ui/                 # shadcn/ui components
│   ├── server/
│   │   ├── routers/            # tRPC routers (pipeline, fleet, audit...)
│   │   ├── services/           # Business logic (config gen, fleet polling)
│   │   ├── db/                 # Prisma schema & client
│   │   └── integrations/       # Git client, Vector GraphQL client
│   ├── lib/
│   │   ├── vector/             # Component catalog, type definitions
│   │   ├── validator/          # WASM validator wrapper
│   │   └── config-generator/   # Flow graph → YAML/TOML serializer
│   └── stores/                 # Zustand stores (flow state, UI state)
├── prisma/
│   └── schema.prisma           # Database schema
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── wasm/
│   └── vector-validator/       # Rust crate compiled to WASM
└── public/
    └── icons/                  # Component type icons
```

## Data Model

### Entity Relationship Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   User       │────<│  TeamMember  │>────│   Team       │
│              │     │  (role)      │     │              │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                           ┌──────▼───────┐
                                           │ Environment  │
                                           │ (dev/stg/prd)│
                                           └──────┬───────┘
                                                  │
         ┌────────────────────────────────────────┼──────────────────┐
         │                                        │                  │
  ┌──────▼───────┐                         ┌──────▼───────┐  ┌──────▼───────┐
  │  VectorNode  │                         │   Pipeline   │  │  Template    │
  │  (host:port) │                         │              │  │  (blueprint) │
  │  (health)    │                         └──────┬───────┘  └──────────────┘
  └──────────────┘                                │
                                    ┌─────────────┼─────────────┐
                                    │             │             │
                             ┌──────▼──────┐ ┌────▼────┐ ┌─────▼──────┐
                             │  Pipeline   │ │  Edge   │ │  Pipeline  │
                             │  Node       │ │(wiring) │ │  Version   │
                             │(source/     │ └─────────┘ │(config     │
                             │ transform/  │             │ snapshot)  │
                             │ sink + cfg) │             └────────────┘
                             └─────────────┘
```

### Prisma Schema

```prisma
model User {
  id            String        @id @default(cuid())
  email         String        @unique
  name          String?
  image         String?
  passwordHash  String?       // null = OIDC-only user
  authMethod    AuthMethod    @default(LOCAL)
  memberships   TeamMember[]
  auditLogs     AuditLog[]
  createdAt     DateTime      @default(now())
}

enum AuthMethod {
  LOCAL         // Email + password
  OIDC          // SSO provider
  BOTH          // Can use either (OIDC user with local backup password)
}

model Team {
  id            String        @id @default(cuid())
  name          String
  members       TeamMember[]
  environments  Environment[]
  templates     Template[]
  createdAt     DateTime      @default(now())
}

model TeamMember {
  id      String   @id @default(cuid())
  userId  String
  teamId  String
  role    Role     // VIEWER, EDITOR, ADMIN
  user    User     @relation(fields: [userId], references: [id])
  team    Team     @relation(fields: [teamId], references: [id])
  @@unique([userId, teamId])
}

enum Role {
  VIEWER      // Read-only access to everything
  EDITOR      // Build, edit, deploy pipelines + manage fleet nodes
  ADMIN       // Full access + manage team members + settings
}

model Environment {
  id          String       @id @default(cuid())
  name        String       // "production", "staging", "dev"
  teamId      String
  team        Team         @relation(fields: [teamId], references: [id])
  nodes       VectorNode[]
  pipelines   Pipeline[]
  deployMode  DeployMode   // API_RELOAD, GITOPS
  gitRepo     String?
  gitBranch   String?
  createdAt   DateTime     @default(now())
}

enum DeployMode {
  API_RELOAD  // Push config + POST /reload
  GITOPS      // Commit to Git, external CD deploys
}

model VectorNode {
  id            String      @id @default(cuid())
  name          String
  host          String
  apiPort       Int         @default(8686)
  environmentId String
  environment   Environment @relation(fields: [environmentId], references: [id])
  status        NodeStatus  @default(UNKNOWN)
  lastSeen      DateTime?
  metadata      Json?
  createdAt     DateTime    @default(now())
}

enum NodeStatus {
  HEALTHY
  DEGRADED
  UNREACHABLE
  UNKNOWN
}

model Pipeline {
  id            String           @id @default(cuid())
  name          String
  description   String?
  environmentId String
  environment   Environment      @relation(fields: [environmentId], references: [id])
  nodes         PipelineNode[]
  edges         PipelineEdge[]
  versions      PipelineVersion[]
  isDraft       Boolean          @default(true)
  deployedAt    DateTime?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
}

model PipelineNode {
  id            String        @id @default(cuid())
  pipelineId    String
  pipeline      Pipeline      @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  componentKey  String        // User-defined name (e.g., "nginx_logs")
  componentType String        // "file", "remap", "elasticsearch"
  kind          ComponentKind
  config        Json          // Component-specific configuration
  positionX     Float         // Canvas position for React Flow
  positionY     Float
}

enum ComponentKind {
  SOURCE
  TRANSFORM
  SINK
}

model PipelineEdge {
  id           String   @id @default(cuid())
  pipelineId   String
  pipeline     Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  sourceNodeId String
  targetNodeId String
  sourcePort   String?  // For components with named outputs (e.g., route)
}

model PipelineVersion {
  id          String   @id @default(cuid())
  pipelineId  String
  pipeline    Pipeline @relation(fields: [pipelineId], references: [id])
  version     Int
  configYaml  String   // Full generated YAML snapshot
  configToml  String?
  createdById String
  changelog   String?
  createdAt   DateTime @default(now())
}

model Template {
  id          String   @id @default(cuid())
  name        String
  description String
  category    String
  teamId      String?  // null = global/built-in
  team        Team?    @relation(fields: [teamId], references: [id])
  nodes       Json
  edges       Json
  createdAt   DateTime @default(now())
}

model AuditLog {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  action      String   // "pipeline.created", "pipeline.deployed", etc.
  entityType  String
  entityId    String
  diff        Json?    // Before/after snapshot
  metadata    Json?    // IP, user agent, environment
  createdAt   DateTime @default(now())

  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
}

model SystemSettings {
  id        String   @id @default("singleton")

  // OIDC
  oidcIssuer       String?
  oidcClientId     String?
  oidcClientSecret String?   // Encrypted at rest (AES-256-GCM)
  oidcDisplayName  String?   @default("SSO")

  // Fleet
  fleetPollIntervalMs     Int @default(15000)
  fleetUnhealthyThreshold Int @default(3)

  // GitOps
  gitopsCommitAuthor String? @default("VectorFlow <vectorflow@company.com>")
  gitopsSshKey       Bytes?  // Encrypted at rest, uploaded via GUI

  // General
  defaultDeployMode DeployMode @default(API_RELOAD)

  updatedAt DateTime @updatedAt
}
```

## UI Architecture

### Page Map

```
/login                          → Local + OIDC login screen
/setup                          → First-run setup wizard (create admin)
/                               → Dashboard (fleet health, recent pipelines)
/pipelines                      → Pipeline list (filterable by environment)
/pipelines/new                  → Create from blank or template
/pipelines/[id]                 → Flow builder (the main canvas)
/pipelines/[id]/versions        → Version history + diff viewer
/pipelines/[id]/deploy          → Deploy wizard (validate → diff → approve → deploy)
/fleet                          → Vector node list with health status
/fleet/[nodeId]                 → Single node detail (live metrics, running config)
/environments                   → Manage environments (dev/staging/prod)
/templates                      → Template library (built-in + custom)
/audit                          → Audit log table (searchable, filterable)
/settings                       → OIDC, fleet, GitOps, team management (Admin only)
```

### Flow Builder Layout

The flow builder is the primary interface. Three-panel layout:

- **Left:** Component palette (sources, transforms, sinks) — drag to canvas
- **Center:** React Flow canvas — nodes connected by edges, left-to-right DAG layout
- **Right:** Detail panel — auto-generated config form for selected node, VRL editor for remap transforms

**Node visual design:**
- Color-coded by kind: green = source, blue = transform, purple = sink
- Data type badges on ports (Log/Metric/Trace) prevent invalid connections
- Live metrics overlay when connected to a running fleet (events/s, bytes/s on edges)
- Health indicators per node aggregated across fleet

**Key interactions:**
- Drag from palette → creates new node
- Drag output port → input port → creates edge (validated by DataType compatibility)
- Click node → opens detail panel with config form
- Cmd+S → save, Cmd+Z/Shift+Z → undo/redo
- Validate button → WASM validator, errors highlighted on nodes
- Import → parse existing YAML/TOML into visual graph (auto-layout via dagre)
- Export → download as YAML or TOML

**Schema-driven config forms:**
Vector's `#[configurable_component]` macros generate JSON Schema for every component. VectorFlow ships a static schema catalog extracted at build time. The detail panel renders config forms automatically from schema — when Vector adds new components, VectorFlow needs only an updated schema file, not new UI code.

**Connection validation:**
Edges enforce DataType compatibility in real-time. A Metric-only output cannot connect to a Log-only input. Invalid connections show a red highlight and snap back.

### Theme System

Built on shadcn/ui CSS variable theming. Dark and light modes with user preference persisted in localStorage + database. React Flow canvas uses custom node/edge styles that inherit from the active theme.

## Fleet Management & Monitoring

### Health Polling

A background service polls each Vector node's GraphQL API on a configurable interval (default 15s):

1. Query component list + per-component metrics via GraphQL
2. Check API responsiveness (health check)
3. Update `NodeStatus` in database
4. Push update to connected browsers via SSE (Server-Sent Events)
5. On threshold breach: mark DEGRADED (error rate > 5%) or UNREACHABLE (N missed polls), fire webhook

**Why SSE over WebSockets:** The server polls the fleet on a fixed interval and pushes updates one-directionally to browsers. SSE is simpler, works through load balancers without special config, and auto-reconnects natively.

### Monitoring Overlay

When a pipeline is deployed and the environment has live nodes, the flow builder overlays real-time metrics:

- Edge labels show throughput (events/s, bytes/s) with animated flow direction
- Node badges show aggregate health across all nodes running that component
- Backpressure indicators surface when sinks are falling behind
- Clicking a node in monitoring mode shows per-node metric breakdowns

### Metrics Storage

- Recent window (1 hour) held in memory for fast dashboard rendering
- Daily rollups persisted to Postgres for historical trends

## Config Generation & Deployment

### Generation Pipeline

1. Walk the React Flow graph (PipelineNodes + PipelineEdges)
2. Build `inputs[]` arrays from edge relationships
3. Merge each node's component config
4. Serialize to YAML (primary) and optionally TOML
5. Validate via WASM validator (`vector validate --dry-run`)
6. Map validation errors back to specific graph nodes

### Deployment Strategies

**API Reload:**
1. Write generated YAML to each node (via shared filesystem, S3, or direct write)
2. POST `/reload` to each Vector node's API
3. Verify health after reload
4. Log result to audit trail

**GitOps:**
1. Clone configured Git repository
2. Write generated YAML to configured path
3. Commit with descriptive message + metadata
4. Push to branch (optionally open a PR)
5. External CD pipeline deploys to nodes

Both strategies are configurable per-environment. Settings (SSH key, commit author, repo URL) are managed in the Admin settings GUI.

### Version History & Rollback

Every deployment creates an immutable `PipelineVersion` snapshot. The version history page shows all versions with diffs. Rollback creates a new version (append-only, never destructive) that copies a previous version's config and deploys it.

### Import Existing Configs

For adoption, VectorFlow can parse existing Vector YAML/TOML configs:
1. Parse sources, transforms, sinks from config file
2. Create PipelineNodes from each component
3. Read `inputs` fields to create PipelineEdges
4. Auto-layout nodes left-to-right via dagre algorithm
5. User sees their existing config as a visual graph

## Authentication & Authorization

### Dual Auth: Local + OIDC

Both authentication methods are first-class and always available:

**Local accounts:** Email + password (bcrypt hashed). Used for initial setup, break-glass access, service accounts, and users without corporate SSO. Always available even if OIDC provider is down.

**OIDC:** SSO via corporate identity provider (Okta, Azure AD, Keycloak, Google). Configured by Admin in `/settings`. Auto-provisions users on first login. Optional email domain restriction.

Users can have `AuthMethod.BOTH` — daily SSO login with a local password as fallback.

### First-Run Setup

On first visit (no users exist), a setup wizard creates the initial local admin account and first team. OIDC is configured afterward in `/settings`.

### Login Screen

Displays email/password form and (if OIDC configured) an SSO button side-by-side.

### RBAC

Three roles with clear hierarchy:

| Role | Capabilities |
|------|-------------|
| VIEWER | Read-only access to all pipelines, fleet, audit logs |
| EDITOR | Build, edit, deploy pipelines. Manage fleet nodes. |
| ADMIN | Everything + manage team members, settings, environments |

Enforcement at two layers:
- **tRPC middleware:** Blocks unauthorized API calls server-side
- **UI:** Hides/disables controls based on role client-side

### Audit Logging

Every mutating action automatically writes an audit log via tRPC middleware. Captures: who (user), what (action + entity), when (timestamp), and the before/after diff. Metadata includes IP address, user agent, and environment.

The audit log viewer (`/audit`) is searchable and filterable by action, user, entity, environment, and date range.

## Admin Settings (GUI-Configurable)

Most configuration is managed by Admins in the `/settings` page — not environment variables. This avoids redeployments for config changes.

**GUI-configurable (hot-reloadable, no restart):**
- OIDC provider settings (issuer, client ID, client secret)
- Fleet polling interval and unhealthy threshold
- GitOps SSH key (uploaded via GUI), commit author
- Default deploy mode
- Team and RBAC management

**Bootstrap env vars only (required to start the container):**
```bash
DATABASE_URL=postgresql://user:pass@host:5432/vectorflow
NEXTAUTH_URL=https://vectorflow.company.com
NEXTAUTH_SECRET=<random-32-chars>
```

Secrets (OIDC client secret, SSH keys) are encrypted at rest using AES-256-GCM, keyed from `NEXTAUTH_SECRET`.

## VRL Playground

The detail panel for `remap` transform nodes includes a Monaco editor with VRL syntax highlighting and an inline test runner.

**How testing works:** The Next.js server shells out to `vector vrl --input <sample> --program <source>`. This guarantees 100% parity with how Vector executes VRL — no reimplementation needed. Latency is ~50-100ms per evaluation, acceptable for interactive use.

The VRL editor also appears for `filter` (condition field) and `route` (per-route conditions) transforms.

## Pipeline Templates

**Built-in templates** for common patterns:

| Category | Examples |
|----------|---------|
| Logging | K8s → Elastic, Syslog → S3, File → Loki |
| Metrics | Prometheus → Datadog, Host Metrics → InfluxDB |
| Security | PII Redaction, Audit Trail, Compliance Filter |
| Migration | Datadog → S3 fallback, Splunk → Elastic |
| Getting Started | Demo Logs → Console, Simple File → HTTP |

**Team templates:** Any pipeline can be saved as a team template via "Save as Template". Team templates are reusable within the team.

Using a template clones its nodes and edges into a new pipeline draft for customization.

## Docker Deployment

### docker-compose.yml

```yaml
services:
  vectorflow:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://vectorflow:${DB_PASSWORD}@postgres:5432/vectorflow
      - NEXTAUTH_URL=https://vectorflow.company.com
      - NEXTAUTH_SECRET=${AUTH_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=vectorflow
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=vectorflow
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-ARGS", "pg_isready", "-U", "vectorflow"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

### Multi-stage Dockerfile

Three stages: dependencies → build → production (standalone output). Alpine-based, ~150-200MB final image. Runs as non-root `vectorflow` user. Entrypoint runs Prisma migrations then starts the server.

### Network Requirements

VectorFlow needs network access to:
1. PostgreSQL (internal Docker network)
2. Each Vector node's API port (default 8686)
3. Git remote (if using GitOps deploy mode)
4. OIDC provider (for authentication)

## Feature Summary

| Area | Features |
|------|----------|
| Flow Builder | Drag-and-drop canvas, schema-driven forms, type-safe connections, undo/redo, import/export |
| Fleet | Node discovery, health polling, live metrics overlay, SSE real-time updates, alerts |
| Deployment | YAML/TOML generation, WASM validation, diff viewer, API reload + GitOps, rollback |
| Auth | Local + OIDC dual auth, break-glass accounts, auto-provisioning |
| RBAC | 3 roles (Admin/Editor/Viewer), tRPC middleware + UI enforcement |
| Audit | Automatic diff-based audit logging, searchable/filterable viewer |
| Settings | GUI-configurable OIDC, fleet, GitOps, SSH key upload, hot-reloadable |
| VRL | Monaco editor with syntax highlighting, inline test runner via `vector vrl` |
| Templates | Built-in + team templates, one-click clone to new pipeline |
| Environments | Multi-env support (dev/staging/prod), separate fleets per environment |
| Versioning | Immutable version snapshots, visual diffs, one-click rollback |
| Deployment | Dockerized, multi-stage build, standalone output, auto-migrations |
| Theme | Dark/light mode, CSS variable theming via shadcn/ui |
