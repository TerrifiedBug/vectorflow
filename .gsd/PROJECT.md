# Project

## What This Is

VectorFlow is a self-hosted control plane for Vector.dev data pipelines. It provides a visual drag-and-drop pipeline editor, fleet deployment with pull-based agents, real-time monitoring, version control with rollback, enterprise auth (OIDC SSO, RBAC, 2FA, SCIM), alerting with webhooks, and a Go agent that runs on fleet nodes. Built with Next.js 16, tRPC, Prisma (PostgreSQL), Zustand, React Flow, and shadcn/ui.

## Core Value

Visual pipeline management with fleet deployment — build Vector configs on a canvas and push them to your infrastructure without hand-editing YAML.

## Current State

Feature-rich and functional. ~316 source files, ~63K lines of TypeScript, plus a Go agent. The product has grown fast with many enterprise features (OIDC, SCIM, audit logging, RBAC, 2FA, alerting, git sync, backups, shared components, AI suggestions). However, the codebase has zero tests, several large monolithic files (1000+ lines), some TypeScript errors from schema drift, duplicated utility functions, and UI inconsistencies across the 35+ dashboard pages.

## Architecture / Key Patterns

- **Frontend:** Next.js 16 App Router, all pages `"use client"`, shadcn/ui components, Zustand stores, React Flow for pipeline canvas, Monaco editor for VRL
- **API:** tRPC with 22 routers, Zod validation, Prisma ORM
- **Auth:** NextAuth v5 beta with credentials + OIDC, PrismaAdapter
- **Agent:** Go binary, pull-based config delivery, heartbeat/metrics push
- **Deployment:** Docker (standalone Next.js output), PostgreSQL
- **Patterns:** Fire-and-forget audit logging, AES-256-GCM encryption for secrets, structured logger with log-injection prevention

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M001: Baseline Quality — Fix TS errors, refactor large files, consistent UI, foundational tests, performance audit
  - [x] S01: TypeScript fixes & shared utilities — completed 2026-03-22
  - [x] S02: Router & component refactoring — completed 2026-03-23
  - [x] S03: UI consistency sweep — completed 2026-03-23
  - [ ] S04: Foundational test suite
  - [ ] S05: Performance audit & optimization
