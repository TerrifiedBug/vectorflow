# VectorFlow — Bug Fixes, UX Improvements & Feature Design

**Date:** 2026-02-28
**Status:** Approved
**Scope:** 3 bug fixes, 3 UX improvements, 2 features

## Summary

This design covers a batch of fixes and enhancements identified during hands-on testing:

- **Bugs:** SSO authentication failure, GitOps deployment failure, VRL test input handling
- **UX:** Detail panel cleanup, SSH key upload flexibility, Docker build speed
- **Features:** VRL snippet library with Monaco autocomplete, pipeline metrics with sparklines and dashboard

Deferred to a future session: 2FA for local users, invite member rework.

---

## Bug Fixes

### B1: SSO "Invalid client secret" with Pocket ID

**Root cause:** VectorFlow registers the OIDC provider without specifying `token_endpoint_auth_method`. NextAuth v5 defaults to `client_secret_basic` (credentials in Authorization header). Pocket ID expects `client_secret_post` (credentials in form body), rejecting the request with "Invalid client secret."

**Secondary issue:** OIDC config is loaded once at module initialization and cached for the server lifetime. Settings changes require a full container restart.

**Fix:**

1. Add `client` config to the OIDC provider:
   ```typescript
   {
     id: "oidc",
     type: "oidc",
     issuer: settings.issuer,
     clientId: settings.clientId,
     clientSecret: decryptedSecret,
     client: {
       token_endpoint_auth_method: settings.tokenEndpointAuthMethod ?? "client_secret_post",
     },
   }
   ```

2. Add `oidcTokenEndpointAuthMethod` field to `SystemSettings` (Prisma schema). Expose as dropdown in settings UI with options: `client_secret_post` (default), `client_secret_basic`.

3. Implement dynamic OIDC provider reloading: instead of caching at module load, lazily resolve OIDC settings on each auth request using NextAuth's provider callback pattern. This eliminates the "restart required after settings change" problem.

4. Add a "Test Connection" button in OIDC settings that:
   - Fetches the provider's `/.well-known/openid-configuration`
   - Validates the issuer, authorization endpoint, and token endpoint are reachable
   - Reports success/failure before the user saves

**Files:** `src/auth.ts`, `src/auth.config.ts`, `src/server/routers/settings.ts`, `prisma/schema.prisma`, `src/app/(dashboard)/settings/` (settings page)

---

### B2: GitOps Deploy "spawn git ENOENT"

**Root cause:** The `git` binary is not installed in the Docker runner stage. `simple-git` shells out to `git` which is not found in PATH.

**Fix:** Add `git` and `openssh-client` to the runner stage of the Dockerfile:

```dockerfile
# In the runner stage
RUN apk add --no-cache git openssh-client
```

**Files:** `docker/Dockerfile`

---

### B3: VRL `parse_json` Failure on Imported Pipelines

**Root cause:** When testing VRL on an imported pipeline, the test input field is empty. VRL expressions like `parse_json!(.message)` fail because `.message` is an empty string, producing: `unable to parse json: expected value at line 1 column 1`.

**Fix:**

1. Default test input when the input field is empty:
   ```json
   {"message": "test event", "timestamp": "2026-01-01T00:00:00Z", "host": "localhost"}
   ```

2. Display a hint: "No test input provided — using default event. Edit to test with your data."

3. For source-specific defaults, infer from the upstream source component type:
   - Syslog source → syslog-formatted default
   - HTTP source → JSON body default
   - Kafka source → message with key/value defaults
   - Fallback → generic JSON event

**Files:** `src/server/routers/vrl.ts`, `src/components/flow/detail-panel.tsx` (VRL test input section)

---

## UX Improvements

### U1: Detail Panel — Remove Redundant Node IP/Port

The fleet node detail page shows IP and port in both the summary section and the edit form. Remove the duplicate display from the summary area since users can see and edit these values in the form below.

**Files:** `src/app/(dashboard)/fleet/[nodeId]/page.tsx`

---

### U2: SSH Key Upload — Accept Extensionless Keys

`ssh-keygen` generates private keys without file extensions (e.g., `id_ed25519`). The file picker's `accept` attribute filters these out, forcing users to rename files.

**Fix:** Remove the `accept` filter from the file input (or set to `accept="*"`). Server-side validation already checks key content integrity, not file extension.

**Files:** Settings page component that renders the SSH key upload input.

---

### U3: Docker Build — Layer Caching for Vector Binary

**Current state:** Vector binary (~80MB) is downloaded on every Docker build because the install command is interleaved with other layers.

**Fix:** Restructure the Dockerfile:

```dockerfile
# Stage: deps (cached unless package.json changes)
FROM node:22-alpine AS deps
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Stage: vector (cached unless VECTOR_VERSION changes)
FROM alpine:3.21 AS vector
ARG VECTOR_VERSION=0.44.0
RUN apk add --no-cache curl && \
    curl -sSfL -o /tmp/vector.tar.gz \
      "https://packages.timber.io/vector/${VECTOR_VERSION}/vector-${VECTOR_VERSION}-x86_64-unknown-linux-musl.tar.gz" && \
    tar xzf /tmp/vector.tar.gz -C /tmp && \
    cp /tmp/vector-*/bin/vector /usr/local/bin/vector && \
    rm -rf /tmp/vector*

# Stage: build (only invalidated by app code changes)
FROM node:22-alpine AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Stage: runner
FROM node:22-alpine AS runner
RUN apk add --no-cache git openssh-client su-exec
COPY --from=vector /usr/local/bin/vector /usr/local/bin/vector
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
```

**Impact:** Code-only rebuilds skip the Vector download entirely. Build time drops from ~4-5 min to ~1-2 min.

Also bump Vector from 0.43.1 to latest stable (currently 0.44.0).

**Licensing:** Vector is MPL 2.0. Redistributing the unmodified binary has zero licensing obligations. MPL copyleft only applies to modified source files.

**Files:** `docker/Dockerfile`

---

## Feature: VRL Snippet Library

### Overview

A categorized, searchable library of VRL code snippets that integrates into the pipeline builder's detail panel. Users click a snippet to insert it at the cursor position in the Monaco VRL editor.

### Data Model

Static array in `src/lib/vrl/snippets.ts` — no database required:

```typescript
interface VrlSnippet {
  id: string;
  name: string;
  description: string;
  category: "Parsing" | "Filtering" | "Enrichment" | "Type Coercion" |
             "Encoding" | "String" | "Timestamp" | "Networking";
  code: string;
  placeholders?: string[];  // Fields the user should customize
}
```

### Snippet Categories (~40-50 total)

| Category | Snippets |
|----------|----------|
| Parsing | `parse_json`, `parse_syslog`, `parse_csv`, `parse_key_value`, `parse_regex`, `parse_grok`, `parse_xml`, `parse_apache_log`, `parse_nginx_log` |
| Filtering | `del(.field)`, `only_fields(.)`, `if/else condition`, `abort`, `assert`, `compact(.)` |
| Enrichment | `set field`, `rename field`, `merge objects`, `add tags`, `set timestamp`, `uuid_v4()` |
| Type Coercion | `to_int`, `to_float`, `to_bool`, `to_string`, `to_timestamp` |
| Encoding | `encode_json`, `encode_logfmt`, `encode_base64`, `decode_base64` |
| String | `downcase`, `upcase`, `strip_whitespace`, `replace`, `contains`, `starts_with`, `split`, `join` |
| Timestamp | `now()`, `format_timestamp`, `parse_timestamp`, `to_unix_timestamp` |
| Networking | `ip_cidr_contains`, `parse_url`, `ip_to_ipv6`, `community_id` |

### UI Design

```
┌─────────────────────────────────────────┐
│ Detail Panel                            │
│ ┌──────────────────┬──────────────────┐ │
│ │ VRL Editor    [S]│ Snippet Library  │ │
│ │                  │ ┌──────────────┐ │ │
│ │ .message =       │ │ Search...    │ │ │
│ │   parse_json     │ ├──────────────┤ │ │
│ │   !(.msg)        │ │ Parsing      │ │ │
│ │                  │ │  parse_json  │ │ │
│ │                  │ │  parse_syslog│ │ │
│ │                  │ │ Filtering    │ │ │
│ │                  │ │  del(.field) │ │ │
│ │                  │ └──────────────┘ │ │
│ └──────────────────┴──────────────────┘ │
│ [Test VRL]  Input: {...}                │
└─────────────────────────────────────────┘
```

- Toggle button `[S]` (book icon) next to VRL editor header
- Drawer panel (~200px wide) opens to the right of the editor
- Search input at top filters across name, description, and code
- Collapsible category sections
- Click a snippet → inserts at cursor position in Monaco
- After insert, placeholders are selected so user can immediately edit

### Monaco Autocomplete

Register snippets as Monaco `CompletionItem`s so typing `parse` triggers autocomplete with snippet suggestions. Each suggestion shows the snippet name, description, and a preview of the code.

### Files

| File | Action |
|------|--------|
| `src/lib/vrl/snippets.ts` | Create — snippet definitions |
| `src/components/flow/vrl-snippet-drawer.tsx` | Create — drawer UI component |
| `src/components/flow/detail-panel.tsx` | Modify — add drawer toggle, integrate snippet insertion |
| `src/components/flow/vrl-editor.tsx` | Modify — register Monaco completions |

---

## Feature: Pipeline Metrics (Sparklines + Dashboard)

### Overview

Two complementary views: inline sparklines on pipeline nodes for at-a-glance throughput, and a full metrics dashboard page per pipeline for deep analysis.

### Data Collection

The fleet poller already queries Vector's GraphQL API every 15s for component metric totals. We extend it to compute rates and store time-series samples.

**Rate computation:** On each poll, calculate `events/sec` and `bytes/sec` by comparing current cumulative totals with previous values, divided by elapsed time.

**Storage:** In-memory ring buffer per component. 1 hour of 15s samples = 240 data points per component. Lost on restart (acceptable for operational metrics).

```typescript
interface MetricSample {
  timestamp: number;
  receivedEventsRate: number;  // events/sec
  sentEventsRate: number;
  receivedBytesRate: number;   // bytes/sec
  sentBytesRate: number;
  errorCount: number;
}

// Map<componentId, MetricSample[]>
const metricStore = new Map<string, MetricSample[]>();
```

### Sparklines on Pipeline Nodes

When a pipeline is deployed and its Vector node is healthy:

- Each node in the flow canvas shows a small sparkline (~60x20px) in the bottom-right corner
- Displays `events/sec` throughput for the last 5 minutes
- Color-coded: green = healthy, yellow = degraded, red = errors/zero throughput
- Tooltip on hover shows exact rate values
- Data pushed via SSE (existing infrastructure)

**Component:** `<NodeSparkline>` renders an SVG `<polyline>` path from the sample array. Subscribes to the SSE event stream that the fleet poller already publishes.

### Dashboard Page

**Route:** `/pipelines/[id]/metrics`

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│ Pipeline: My Pipeline    Node: [prod-vector-01 ▼]   │
│ Time: [5m] [15m] [1h]                               │
├────────────┬────────────┬─────────────┬─────────────┤
│ Events In  │ Events Out │ Error Rate  │ Uptime      │
│ 1,234/s    │ 1,230/s    │ 0.3%        │ 99.9%       │
├─────────────────────────────────────────────────────┤
│ Component         │ In/s    │ Out/s   │ Chart       │
│ ─────────────────────────────────────────────────── │
│ kafka_source      │ 1,234   │ 1,234   │ ▃▅▇▆▅▃▂▃▅  │
│ parse_logs        │ 1,234   │ 1,230   │ ▃▅▇▆▅▃▂▃▅  │
│ elasticsearch     │ 1,230   │ 1,230   │ ▃▅▇▆▅▃▂▃▅  │
└─────────────────────────────────────────────────────┘
```

- Summary cards: total events in/out per second, error rate, uptime percentage
- Per-component table with inline area charts (sparklines but wider)
- Click a component row to expand a full-width time-series chart
- Node selector dropdown (for pipelines deployed to multiple nodes)
- Time range selector: 5min, 15min, 1hour

**Charting:** Use `recharts` (lightweight React charting library, composable, well-maintained).

### Data Flow

```
Fleet Poller (15s interval)
  → GraphQL query to Vector node
  → Compute rates from cumulative totals
  → Store in in-memory ring buffer
  → Push via SSE to connected browsers
  → tRPC query endpoint for initial page load
```

### Files

| File | Action |
|------|--------|
| `src/server/services/fleet-poller.ts` | Modify — add rate computation, in-memory metric store |
| `src/server/services/metric-store.ts` | Create — in-memory ring buffer with typed API |
| `src/server/routers/metrics.ts` | Create — tRPC router for metric queries |
| `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx` | Create — dashboard page |
| `src/components/metrics/summary-cards.tsx` | Create — summary card components |
| `src/components/metrics/component-chart.tsx` | Create — per-component area chart |
| `src/components/flow/node-sparkline.tsx` | Create — inline sparkline for flow nodes |
| `src/components/flow/node-types.tsx` | Modify — integrate sparkline into node rendering |
| `package.json` | Modify — add `recharts` dependency |

---

## Datadog Observability Pipelines — Competitive Notes

Reviewed per user request. Key findings:

- **Not open source.** Datadog OP is a proprietary commercial product built on top of Vector (MPL 2.0).
- **No licensing risk** for VectorFlow. We don't use any Datadog code. VectorFlow manages Vector instances via their public GraphQL API and config files.
- **Feature parity opportunities:** Sensitive data scanning/redaction rules, enrichment tables (CSV lookup), pipeline templates for common use cases, live capture/preview of flowing data.
- **VectorFlow's differentiators:** Fully open source, self-hosted, no per-GB pricing, multi-instance fleet management, version control and rollback, VRL editing with syntax highlighting.

No action items — this is strategic context for future roadmap planning.

---

## Deferred Items

| Item | Reason |
|------|--------|
| 2FA for local users (OTP/passkeys) | Not broken, can be added later |
| Invite member rework (shareable links) | Current add-by-email works, SMTP not configured |
| Sensitive data scanning rules | Future feature inspired by Datadog OP |
| Live data capture/preview | Future feature — requires proxying through Vector |

---

## Implementation Order

1. **B2: GitOps ENOENT** — one-line Dockerfile fix, unblocks GitOps testing
2. **U3: Docker build caching** — Dockerfile restructure (do with B2)
3. **B1: SSO fix** — auth.ts + settings schema changes
4. **B3: VRL default input** — VRL router + detail panel
5. **U1: Detail panel cleanup** — remove redundant display
6. **U2: SSH key upload** — remove file extension filter
7. **VRL snippet library** — new component + snippet definitions
8. **Pipeline metrics** — fleet poller extension + sparklines + dashboard
