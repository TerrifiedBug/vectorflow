# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**AI Providers:**
- OpenAI (default) - VRL and pipeline suggestions
  - SDK/Client: Native OpenAI-compatible HTTP client
  - Configuration: Stored in `Team.aiProvider`, `Team.aiBaseUrl`, `Team.aiModel`
  - API Key: Encrypted in `Team.aiApiKey` (via `crypto.ts`)
  - Default models: `gpt-4o` (OpenAI), `claude-sonnet-4-20250514` (Anthropic)
  - Base URLs: `https://api.openai.com/v1`, `https://api.anthropic.com/v1`
  - Custom providers: OpenAI-compatible APIs supported via `Team.aiBaseUrl`
  - Implementation: `src/server/services/ai.ts`, `src/lib/ai/rate-limiter.ts`

**Notification Channels:**
- Slack - Alert delivery via webhooks
  - Endpoint: Webhook URL (stored in `NotificationChannel.config`)
  - Format: Block Kit format with status emoji, metrics, dashboard link
  - Implementation: `src/server/services/channels/slack.ts`

- PagerDuty - Incident management integration
  - Endpoint: `https://events.pagerduty.com/v2/enqueue`
  - Configuration: Integration key in `NotificationChannel.config`
  - Dedup key: `vectorflow-{alertId}` for incident correlation
  - Severity mapping: Configurable in channel config
  - Implementation: `src/server/services/channels/pagerduty.ts`

- Email - SMTP-based alert delivery
  - SDK/Client: `nodemailer@8.0.1`
  - Configuration: SMTP host, port, auth in `NotificationChannel.config`
  - SMTP host validation: Via `validateSmtpHost()` to prevent internal network access
  - HTML templates: Styled email notifications with alert details
  - Implementation: `src/server/services/channels/email.ts`

- Generic Webhooks - Custom HTTP endpoints
  - Endpoint: Configurable URL (stored in config)
  - Authentication: Optional HMAC-SHA256 signature in `X-VectorFlow-Signature` header
  - Payload: JSON with alert details, metrics, and dashboard link
  - URL validation: Prevents internal/private network access
  - Timeout: 10 second per webhook
  - Implementation: `src/server/services/channels/webhook.ts`

**Vector Data Pipeline:**
- Vector - Local telemetry pipeline engine
  - Binary: Spawned as child process (configurable path via `VF_VECTOR_BIN`)
  - Configuration: YAML format written to disk at runtime
  - Data directory: `.vectorflow/vector-data/`
  - System pipeline: User-defined sources, transforms, sinks
  - Audit log source: Automatically injected with runtime path
  - Implementation: `src/server/services/system-vector.ts`
  - Component schemas: `src/lib/vector/schemas/` (sources, sinks, transforms)
  - Catalog: `src/lib/vector/catalog.ts` (component metadata)

## Data Storage

**Databases:**
- PostgreSQL 12+ (primary data store)
  - Connection: Via `process.env.DATABASE_URL`
  - Adapter: `@prisma/adapter-pg@7.4.2` (Prisma driver)
  - ORM: Prisma 7.4.2
  - Schema: `prisma/schema.prisma`
  - Models: User, Team, Pipeline, Environment, AiConversation, NotificationChannel, AlertRule, etc.
  - Migrations: Version-controlled in `prisma/migrations/`
  - Features: Multi-tenancy (Team-scoped), audit logging

**File Storage:**
- Local filesystem only
  - Backup directory: `process.env.VF_BACKUP_DIR` (default: `/backups`)
  - System config: `process.env.VF_SYSTEM_CONFIG_PATH` (default: `.vectorflow/system-pipeline.yaml`)
  - Audit logs: `process.env.VF_AUDIT_LOG_PATH` (default: `/var/lib/vectorflow/audit.log`)
  - Vector data: `.vectorflow/vector-data/`
  - No cloud storage (S3, GCS, etc.) integrated

**Caching:**
- In-memory metric store - No external cache required
  - Implementation: `src/server/services/metric-store.ts`
  - TanStack React Query - Client-side data caching
  - Global singleton pattern to prevent duplication

## Authentication & Identity

**Auth Provider:**
- NextAuth 5.0.0-beta.30 (custom implementation)
  - Configuration: `src/auth.config.ts`, `src/auth.ts`
  - Approach: Hybrid local + OIDC
  - Session: JWT-based (`session.strategy: "jwt"`)
  - Adapter: Prisma for user/account persistence

**Local Authentication:**
- Credentials provider - Email + password
  - Password hashing: bcryptjs with salt
  - 2FA: TOTP/OTP with backup codes
  - Account lockout: User lockout tracking
  - Audit: Login attempts logged

**SSO / OIDC:**
- OpenID Connect - Optional SSO configuration
  - Settings: Stored in `SystemSettings` model
  - Configuration keys: `oidcIssuer`, `oidcClientId`, `oidcClientSecret`, `oidcDisplayName`
  - Token endpoint: Configurable auth method (default: `client_secret_post`)
  - Group sync: Optional OIDC group mapping to VectorFlow teams
  - Scopes: Configurable (`oidcGroupsScope`), defaults to "groups"
  - Claims: Configurable claim name for groups (default: "groups")
  - Implementation: `src/auth.ts` (lines 35-65)

**Service Accounts:**
- Token-based API auth for external integrations
  - Token storage: `ServiceAccount` model in database
  - REST API v1 - Bearer token authentication at `src/app/api/v1/*`
  - Agent API - Enrollment tokens at `src/app/api/agent/*`

**SCIM API:**
- System for Cross-domain Identity Management
  - Endpoint: `/api/scim/v2/*`
  - Bearer token authentication
  - Group provisioning: Group and User management
  - Implementation: `src/app/api/scim/v2/`
  - Sync: One-way SCIM-to-VectorFlow group provisioning

## Monitoring & Observability

**Error Tracking:**
- None detected - No external error tracking service (Sentry, DataDog, etc.)
- Custom implementation: Error logging to stdout/stderr

**Logs:**
- Local file-based logging
  - Level: `process.env.VF_LOG_LEVEL` (default: "info")
  - Audit logs: File-based audit trail at `VF_AUDIT_LOG_PATH`
  - Destination: Console + audit log file
  - Implementation: `src/lib/logger.ts`

**Metrics:**
- In-memory metric store with periodic cleanup
  - Sources: Vector pipeline metrics via `/api/metrics` endpoints
  - Storage: In-memory cache (not persisted)
  - Cleanup: Scheduled via `metrics-cleanup.ts`
  - Implementation: `src/server/services/metric-store.ts`

## CI/CD & Deployment

**Hosting:**
- Self-hosted / Docker
  - Build output: Standalone Next.js (no Node.js dependency in output)
  - Database: External PostgreSQL required
  - Runtime: Node.js LTS

**CI Pipeline:**
- Not detected in codebase - Deployment config external
- PR checks: Greptile code review (GitHub integration)

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_SECRET` - JWT signing secret (minimum 32 bytes)
- `NEXTAUTH_URL` - Public app URL (for callback URLs)

**Secrets location:**
- `.env` file (not committed, in `.gitignore`)
- Encrypted in database: AI API keys, OIDC client secrets, Git PAT
- Encryption: Via `crypto.ts` using `NEXTAUTH_SECRET`

## Webhooks & Callbacks

**Incoming:**
- Health check endpoint: `GET /api/health`
- Agent heartbeat: `POST /api/agent/heartbeat`
- Webhooks for pipeline deployments: Stored in `Environment` model
- Git push webhooks: Can trigger GitSync on pipeline commits

**Outgoing:**
- Slack webhooks - Alert notifications
- PagerDuty Events API - Incident management
- Email via SMTP - Alert delivery
- Generic webhooks - Custom alert destinations
- Git push - GitSync commits to repository
  - Supports: GitHub, GitLab, Bitbucket
  - Authentication: Personal access token (encrypted)
  - Implementation: `src/server/services/git-sync.ts`

**Agent Communication:**
- Agent-to-Dashboard: Heartbeat HTTP POST
- Dashboard-to-Agent: Config HTTP GET, metrics polling
- Enrollment tokens: Secure agent onboarding
- Implementation: `src/app/api/agent/config/route.ts`, `src/app/api/agent/heartbeat/route.ts`

## External Data Sources

**Vector Integration Points:**
- Sources: Kubernetes, Docker, files, syslog, HTTP, Datadog, CloudWatch, etc.
- Sinks: AWS (S3, CloudWatch, Kinesis), Azure, GCP, Datadog, New Relic, Splunk, etc.
- Authentication: Per-sink configuration (API keys, managed credentials)
- Schema validation: `src/lib/vector/source-output-schemas.ts`, component schemas

---

*Integration audit: 2026-03-22*
