# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**
- TypeScript 5 - All source code (`src/**/*.ts`, `src/**/*.tsx`)
- JavaScript (React 19) - Frontend UI and components
- YAML - Vector pipeline configuration (`.vectorflow/system-pipeline.yaml`)
- SQL - Database schema managed by Prisma

**Secondary:**
- Bash - Scripts and CLI tools
- JSON - Configuration and data files

## Runtime

**Environment:**
- Node.js (version not pinned, uses packageManager spec in package.json)
- Next.js 16.1.6 - Full-stack framework (SSR, API routes, standalone build)
- React 19.2.3 - UI component framework
- React DOM 19.2.3 - DOM rendering

**Package Manager:**
- pnpm 10.13.1 - Dependency management
- Lockfile: `pnpm-lock.yaml` (tracked in repo, use `pnpm install`)
- Override rules: `hono>=4.11.10`, `lodash>=4.17.23`

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack React framework with API routes
  - Configuration: `next.config.ts`
  - Standalone build output enabled
  - Server actions: 2mb size limit
  - Edge Runtime incompatibility: Uses Node.js-only modules in auth and database layers
- React 19.2.3 - UI component library
- TailwindCSS 4 - Utility-first CSS framework
  - Configuration: Integrated in build, no separate tailwind.config (uses @tailwindcss/postcss)
  - PostCSS: `postcss.config.mjs`

**Backend & Data:**
- Prisma 7.4.2 - ORM for PostgreSQL
  - Configuration: `prisma/schema.prisma`
  - Client: `@prisma/client@7.4.2` with `@prisma/adapter-pg@7.4.2` for PostgreSQL
  - Schema location: `prisma/schema.prisma`
  - Migrations: `prisma/migrations/`
  - Generated client: `src/generated/prisma/`
  - Post-install: `prisma generate` (runs automatically)

**API & RPC:**
- tRPC 11.8.0 - End-to-end typesafe API
  - Client: `@trpc/client@11.8.0` (React hooks)
  - Server: `@trpc/server@11.8.0`
  - React integration: `@trpc/tanstack-react-query@11.8.0`
  - Server routers: `src/server/routers/`
  - Client setup: `src/trpc/client.tsx`
- REST API v1 - Bearer token authentication at `src/app/api/v1/`

**Authentication & Authorization:**
- NextAuth 5.0.0-beta.30 - Authentication
  - Configuration: `src/auth.config.ts`, `src/auth.ts`
  - Adapter: `@auth/prisma-adapter@2.11.1` for database sessions
  - Providers: Credentials (local), OIDC (configurable)
  - Session strategy: JWT
  - Features: 2FA/TOTP, password hashing (bcryptjs), account lockout
- bcryptjs 3.0.3 - Password hashing

**Testing & Development:**
- ESLint 9 - Linting with Next.js config
  - Config: `eslint.config.mjs` (flat config)
  - Ignores generated code: `src/generated/`
- TypeScript 5 - Type checking
  - Config: `tsconfig.json`
  - Target: ES2017
  - Module resolution: bundler
  - Path alias: `@/*` → `src/*`

## Key Dependencies

**Critical:**
- `@prisma/adapter-pg@7.4.2` - PostgreSQL connection adapter for Prisma
- `@prisma/client@7.4.2` - ORM runtime
- `next-auth@5.0.0-beta.30` - Session management and auth flows
- `@trpc/server@11.8.0` - Type-safe API endpoint definitions
- `react@19.2.3` - Component rendering engine

**Infrastructure & Utilities:**
- `zustand@5.0.11` - State management (client)
- `@tanstack/react-query@5.90.21` - Server state and caching
- `zod@4.3.6` - Runtime validation and schemas
- `class-variance-authority@0.7.1` - Variant-based component styling
- `radix-ui@1.4.3` - Headless UI components
- `tailwind-merge@3.5.0` - Smart Tailwind class merging

**Data Processing & UI:**
- `@xyflow/react@12.10.1` - Graph visualization for pipelines (DAG editor)
- `@dagrejs/dagre@2.0.4` - DAG layout algorithm
- `@monaco-editor/react@4.7.0` - Monaco editor for VRL syntax
- `monaco-editor@0.55.1` - Monaco editor distribution
- `recharts@2.15.4` - React charting library for metrics
- `react-grid-layout@2.2.2` - Grid layout system

**Forms & Validation:**
- `react-hook-form@7.71.2` - Form state management
- `@hookform/resolvers@5.2.2` - Integration with validation libraries

**Notifications & Channels:**
- `sonner@2.0.7` - Toast notifications
- `nodemailer@8.0.1` - SMTP email delivery

**Utilities:**
- `js-yaml@4.1.1` - YAML parsing/serialization (Vector config)
- `nanoid@5.1.6` - Unique ID generation
- `qrcode@1.5.4` - QR code generation (2FA/TOTP)
- `otpauth@9.5.0` - TOTP/OTP generation and validation
- `simple-git@3.32.3` - Git operations (GitSync commits)
- `diff@8.0.3` - Diff generation
- `node-cron@4.2.1` - Scheduled tasks
- `superjson@2.2.6` - JSON serialization for complex types
- `dotenv@17.3.1` - Environment variable loading
- `clsx@2.1.1` - Conditional className helper
- `cmdk@1.1.1` - Command/search dialog
- `lucide-react@0.575.0` - Icon library
- `next-themes@0.4.6` - Dark mode theme management

## Configuration

**Environment:**
- `.env` file (not committed) - Runtime configuration
- `process.env.DATABASE_URL` - PostgreSQL connection string (required)
- `process.env.NEXTAUTH_SECRET` - NextAuth JWT secret (required)
- `process.env.NEXTAUTH_URL` - Public application URL (optional, defaults to localhost:3000)
- `process.env.NODE_ENV` - Environment detection ("development", "production")
- `process.env.NEXT_RUNTIME` - Runtime detection ("nodejs", "edge")

**VectorFlow-Specific Env Vars:**
- `process.env.VF_VECTOR_BIN` - Path to Vector binary (default: "vector")
- `process.env.VF_SYSTEM_CONFIG_PATH` - Path to system pipeline config (default: `.vectorflow/system-pipeline.yaml`)
- `process.env.VF_AUDIT_LOG_PATH` - Path to audit log file (default: `/var/lib/vectorflow/audit.log`)
- `process.env.VF_BACKUP_DIR` - Directory for database backups (default: `/backups`)
- `process.env.VF_VERSION` - Application version (default: "dev")
- `process.env.VF_LOG_LEVEL` / `process.env.LOG_LEVEL` - Logging level (default: "info")
- `process.env.VF_DISABLE_LOCAL_AUTH` - Disable credential login ("true" to disable)
- `process.env.PORT` - Server port (default: 3000, used for agent config URLs)

**Build:**
- `tsconfig.json` - TypeScript configuration
- `next.config.ts` - Next.js configuration
- `postcss.config.mjs` - PostCSS configuration for Tailwind
- `eslint.config.mjs` - ESLint configuration (flat config)

## Platform Requirements

**Development:**
- Node.js (LTS or later recommended)
- pnpm 10.13.1 or compatible version
- PostgreSQL 12+ database
- Git (for GitSync functionality)
- Vector binary (optional, for local pipeline testing)

**Production:**
- Node.js LTS (server runtime)
- PostgreSQL 12+ (data persistence)
- Vector binary (for system pipeline execution)
- Optional: SMTP server (for email notifications)
- Optional: External AI provider (OpenAI, Anthropic, or compatible OpenAI API)

**Build Output:**
- Standalone Docker-friendly build (`output: "standalone"` in next.config.ts)
- No Node.js modules bundled with output
- Requires `node_modules` and `.next` at runtime

---

*Stack analysis: 2026-03-22*
