# Project

## What This Is

VectorFlow is a self-hosted control plane for Vector.dev data pipelines. It provides a visual drag-and-drop pipeline editor, fleet deployment with pull-based agents, real-time monitoring, version control with rollback, enterprise auth (OIDC SSO, RBAC, 2FA, SCIM), alerting with webhooks, and a Go agent that runs on fleet nodes. Built with Next.js 16, tRPC, Prisma (PostgreSQL), Zustand, React Flow, and shadcn/ui.

## Core Value

Visual pipeline management with fleet deployment — build Vector configs on a canvas and push them to your infrastructure without hand-editing YAML.

## Current State

Feature-rich and functional with a clean quality baseline. ~316 source files, ~63K lines of TypeScript, plus a Go agent. M001 established: zero TS/lint errors, 105 foundational tests, all large files refactored under ~800 lines, consistent UI patterns across 30+ dashboard pages, shared utility modules, extracted service layers, and a performance audit. The codebase is ready for feature development with quality guardrails in place.

## Architecture / Key Patterns

- **Frontend:** Next.js 16 App Router, all pages `"use client"`, shadcn/ui components, Zustand stores, React Flow for pipeline canvas, Monaco editor for VRL
- **API:** tRPC with 22 routers, Zod validation, Prisma ORM
- **Auth:** NextAuth v5 beta with credentials + OIDC, PrismaAdapter
- **Agent:** Go binary, pull-based config delivery, heartbeat/metrics push
- **Deployment:** Docker (standalone Next.js output), PostgreSQL
- **Patterns:** Fire-and-forget audit logging, AES-256-GCM encryption for secrets, structured logger with log-injection prevention
- **Testing:** Vitest 4.1.0 + vitest-mock-extended, Prisma deep mocking (D006 inline pattern), 105 tests across 7 files
- **Services:** Pure function service modules in `src/server/services/` (D004 pattern), shared utilities in `src/lib/` (pipeline-status, format, status)
- **UI:** Shared `EmptyState` and `QueryError` components for consistent dashboard states

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] **M001: Baseline Quality** — completed 2026-03-23
  - Zero TS/lint errors, 105 tests, all files under ~800 lines, consistent UI, performance audit
  - 9 requirements validated (R001–R008, R010), 1 deferred (R009)
  - 62 files changed, 7662 insertions, 3578 deletions
  - See `.gsd/milestones/M001/M001-SUMMARY.md` for full details
