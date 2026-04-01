# API Reference

VectorFlow exposes its API via [tRPC](https://trpc.io/) -- a type-safe RPC framework built on HTTP. All API calls go through a single endpoint at `/api/trpc`, rather than traditional REST paths. This page documents every router, its procedures, and how to call them programmatically.

## Calling convention

tRPC uses a URL-based calling convention where the procedure name is encoded in the path:

```
# Query (read operation) — HTTP GET
GET /api/trpc/<router>.<procedure>?input=<url-encoded-json>

# Mutation (write operation) — HTTP POST
POST /api/trpc/<router>.<procedure>
Content-Type: application/json

{"json": <input-object>}
```

Responses are JSON-wrapped:

```json
{
  "result": {
    "data": {
      "json": { ... }
    }
  }
}
```

VectorFlow uses [SuperJSON](https://github.com/blitz-js/superjson) as its serialization transformer, which means Date objects and BigInts are automatically serialized and deserialized. When calling the API with raw HTTP, you receive SuperJSON-encoded output -- dates appear as ISO strings with type annotations.

### Example: list pipelines

{% tabs %}
{% tab title="curl" %}
```bash
# Query — GET with URL-encoded JSON input
curl -s 'https://vectorflow.example.com/api/trpc/pipeline.list?input=%7B%22json%22%3A%7B%22environmentId%22%3A%22clxyz123%22%7D%7D' \
  -H 'Cookie: authjs.session-token=<session-token>'
```
{% endtab %}
{% tab title="fetch" %}
```typescript
const input = encodeURIComponent(
  JSON.stringify({ json: { environmentId: "clxyz123" } })
);

const res = await fetch(
  `https://vectorflow.example.com/api/trpc/pipeline.list?input=${input}`,
  {
    headers: { Cookie: `authjs.session-token=${sessionToken}` },
  }
);

const { result } = await res.json();
const pipelines = result.data.json;
```
{% endtab %}
{% endtabs %}

### Example: create a pipeline

{% tabs %}
{% tab title="curl" %}
```bash
# Mutation — POST with JSON body
curl -s -X POST 'https://vectorflow.example.com/api/trpc/pipeline.create' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: authjs.session-token=<session-token>' \
  -d '{"json": {"name": "syslog-to-s3", "environmentId": "clxyz123"}}'
```
{% endtab %}
{% tab title="fetch" %}
```typescript
const res = await fetch(
  "https://vectorflow.example.com/api/trpc/pipeline.create",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `authjs.session-token=${sessionToken}`,
    },
    body: JSON.stringify({
      json: { name: "syslog-to-s3", environmentId: "clxyz123" },
    }),
  }
);

const { result } = await res.json();
const pipeline = result.data.json;
```
{% endtab %}
{% endtabs %}

---

## Authentication

All API procedures (except the agent enrollment endpoint) require an authenticated session.

VectorFlow supports two authentication methods:

1. **Session cookies** -- Used by the web UI. When you sign in, an `authjs.session-token` cookie is set. Include this cookie in tRPC API requests.
2. **Service account API keys** -- Used for programmatic access via the REST API (`/api/v1/*`). Pass the key as a Bearer token in the `Authorization` header.

{% hint style="info" %}
For CI/CD and automation, create a [Service Account](../operations/service-accounts.md) to get a dedicated API key with scoped permissions.
{% endhint %}

### Roles

Every procedure enforces a minimum role. VectorFlow has three roles, in ascending order of privilege:

| Role | Level | Description |
|------|-------|-------------|
| `VIEWER` | 0 | Read-only access to pipelines, fleet, metrics, and logs |
| `EDITOR` | 1 | Create, update, deploy, and delete pipelines, secrets, and alerts |
| `ADMIN` | 2 | Manage environments, teams, members, enrollment tokens, and agent revocation |

Some procedures require **Super Admin** access -- this is a server-wide flag on the user account, separate from team roles.

---

## Router index

| Router | Prefix | Description |
|--------|--------|-------------|
| `pipeline` | `pipeline.*` | Pipeline CRUD, graph saving, versioning, deployment status, metrics, logs, event sampling |
| `deploy` | `deploy.*` | Deploy preview, deploy to agents, undeploy |
| `fleet` | `fleet.*` | Fleet node management, node logs, node metrics, agent updates |
| `environment` | `environment.*` | Environment CRUD, enrollment tokens |
| `alert` | `alert.*` | Alert rules, webhooks, alert events |
| `template` | `template.*` | Pipeline template management |
| `secret` | `secret.*` | Encrypted secret management |
| `certificate` | `certificate.*` | TLS certificate management |
| `dashboard` | `dashboard.*` | Dashboard statistics and chart data |
| `team` | `team.*` | Team management, member roles |
| `user` | `user.*` | User profile, password changes, TOTP setup |
| `audit` | `audit.*` | Audit log queries |
| `vrl` | `vrl.*` | VRL expression testing |
| `vrlSnippet` | `vrlSnippet.*` | VRL snippet library |
| `admin` | `admin.*` | User management, super admin operations |
| `settings` | `settings.*` | System settings — OIDC, fleet, backup, SCIM (Super Admin) |
| `metrics` | `metrics.*` | Pipeline and component metrics, live rates |
| `validator` | `validator.*` | Pipeline config validation |
| `serviceAccount` | `serviceAccount.*` | Service account API key management |
| `userPreference` | `userPreference.*` | Per-user UI preferences |
| `sharedComponent` | `sharedComponent.*` | Reusable pipeline components shared across pipelines |
| `aiRouter` | `aiRouter.*` | AI assistant conversations and suggestions |
| `pipelineGroup` | `pipelineGroup.*` | Pipeline folder organization |
| `pipelineDependency` | `pipelineDependency.*` | Inter-pipeline dependency graph |
| `promotion` | `promotion.*` | Cross-environment pipeline promotion with approval workflow |
| `stagedRollout` | `stagedRollout.*` | Canary and staged pipeline deployments |
| `nodeGroup` | `nodeGroup.*` | Node grouping with label-based criteria and health stats |
| `webhookEndpoint` | `webhookEndpoint.*` | Outbound webhook endpoint management and delivery history |
| `gitSync` | `gitSync.*` | GitOps sync status, jobs, and error tracking |
| `migration` | `migration.*` | Config migration from Fluentd to Vector |
| `analytics` | `analytics.*` | Cost analytics, per-pipeline breakdown, CSV export |
| `costRecommendation` | `costRecommendation.*` | Cost optimization recommendations and analysis |
| `anomaly` | `anomaly.*` | Anomaly detection events, acknowledgement, dismissal |
| `filterPreset` | `filterPreset.*` | Saved filter presets for pipeline and fleet views |

---

## Pipeline router

Manage pipeline definitions, graphs, versions, and runtime data.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `pipeline.list` | query | VIEWER | `{ environmentId: string }` | List all pipelines in an environment |
| `pipeline.get` | query | VIEWER | `{ id: string }` | Get a pipeline with its nodes, edges, and config change status |
| `pipeline.create` | mutation | EDITOR | `{ name: string, description?: string, environmentId: string }` | Create a new draft pipeline |
| `pipeline.update` | mutation | EDITOR | `{ id: string, name?: string, description?: string \| null }` | Update pipeline name or description |
| `pipeline.delete` | mutation | EDITOR | `{ id: string }` | Delete a pipeline (undeploys first if deployed) |
| `pipeline.clone` | mutation | EDITOR | `{ pipelineId: string }` | Clone a pipeline within the same environment |
| `pipeline.promote` | mutation | EDITOR | `{ pipelineId: string, targetEnvironmentId: string, name?: string }` | Copy a pipeline to a different environment (strips secrets) |
| `pipeline.saveGraph` | mutation | EDITOR | `{ pipelineId: string, nodes: Node[], edges: Edge[], globalConfig?: object }` | Save the visual pipeline graph |
| `pipeline.versions` | query | VIEWER | `{ pipelineId: string }` | List all deployed versions of a pipeline |
| `pipeline.getVersion` | query | VIEWER | `{ versionId: string }` | Get a specific version with its config YAML |
| `pipeline.createVersion` | mutation | EDITOR | `{ pipelineId: string, configYaml: string, changelog?: string }` | Create a new pipeline version |
| `pipeline.rollback` | mutation | EDITOR | `{ pipelineId: string, targetVersionId: string }` | Roll back to a previous version |
| `pipeline.deploymentStatus` | query | VIEWER | `{ pipelineId: string }` | Get per-node deployment status for a pipeline |
| `pipeline.metrics` | query | VIEWER | `{ pipelineId: string, hours?: number }` | Get pipeline metrics (events, bytes, errors) over time |
| `pipeline.logs` | query | VIEWER | `{ pipelineId: string, cursor?: string, limit?: number, levels?: LogLevel[], nodeId?: string, since?: Date }` | Paginated pipeline logs |
| `pipeline.requestSamples` | mutation | EDITOR | `{ pipelineId: string, componentKeys: string[], limit?: number }` | Request live event samples from running components |
| `pipeline.sampleResult` | query | VIEWER | `{ requestId: string }` | Poll for event sample results |
| `pipeline.eventSchemas` | query | VIEWER | `{ pipelineId: string }` | Get discovered event schemas per component |

<details>
<summary>Pipeline name validation</summary>

Pipeline names must match the pattern `^[a-zA-Z0-9][a-zA-Z0-9 _-]*$` and be between 1 and 100 characters long. The name must start with a letter or number and may contain letters, numbers, spaces, hyphens, and underscores.
</details>

<details>
<summary>Node schema</summary>

Each node in the `saveGraph` input:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string?` | Optional ID (auto-generated if omitted) |
| `componentKey` | `string` | Auto-generated unique identifier within the pipeline (e.g., `syslog_k7xMp2nQ`). Must match `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| `displayName` | `string?` | Optional human-readable name for the component (e.g., "Syslog Source") |
| `componentType` | `string` | Vector component type (e.g., `syslog`, `remap`, `aws_s3`) |
| `kind` | `"SOURCE" \| "TRANSFORM" \| "SINK"` | Component category |
| `config` | `object` | Component configuration fields |
| `positionX` | `number` | X coordinate in the visual editor |
| `positionY` | `number` | Y coordinate in the visual editor |
| `disabled` | `boolean` | Whether the node is excluded from the generated config |
</details>

---

## Deploy router

Preview and execute pipeline deployments.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `deploy.preview` | query | VIEWER | `{ pipelineId: string }` | Generate and validate the YAML config, return diff against deployed version |
| `deploy.agent` | mutation | EDITOR | `{ pipelineId: string, changelog: string }` | Deploy a pipeline -- validates config, creates a version, marks as deployed |
| `deploy.undeploy` | mutation | EDITOR | `{ pipelineId: string }` | Undeploy a pipeline (agents stop it on next poll) |
| `deploy.environmentInfo` | query | VIEWER | `{ pipelineId: string }` | Get the environment and node list for a pipeline |

---

## Fleet router

Manage agent nodes and view their status, logs, and metrics.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `fleet.list` | query | VIEWER | `{ environmentId: string }` | List all nodes in an environment |
| `fleet.get` | query | VIEWER | `{ id: string }` | Get a node with its pipeline statuses |
| `fleet.create` | mutation | EDITOR | `{ name: string, host: string, apiPort?: number, environmentId: string }` | Register a node manually |
| `fleet.update` | mutation | EDITOR | `{ id: string, name?: string }` | Update node name |
| `fleet.delete` | mutation | EDITOR | `{ id: string }` | Delete a node |
| `fleet.revokeNode` | mutation | ADMIN | `{ id: string }` | Revoke a node's token (prevents further communication) |
| `fleet.nodeLogs` | query | VIEWER | `{ nodeId: string, cursor?: string, limit?: number, levels?: LogLevel[], pipelineId?: string }` | Paginated logs for a node |
| `fleet.nodeMetrics` | query | VIEWER | `{ nodeId: string, hours?: number }` | System metrics for a node (CPU, memory, disk, network) |
| `fleet.triggerAgentUpdate` | mutation | ADMIN | `{ nodeId: string, targetVersion: string, downloadUrl: string, checksum: string }` | Trigger a self-update on a standalone agent |
| `fleet.listWithPipelineStatus` | query | VIEWER | `{ environmentId: string }` | List nodes with per-pipeline deployment status |

---

## Environment router

Manage environments and enrollment tokens.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `environment.list` | query | VIEWER | `{ teamId: string }` | List environments for a team |
| `environment.get` | query | VIEWER | `{ id: string }` | Get environment details including node count |
| `environment.create` | mutation | EDITOR | `{ name: string, teamId: string }` | Create a new environment |
| `environment.update` | mutation | EDITOR | `{ id: string, name?: string, secretBackend?: string, secretBackendConfig?: any }` | Update environment name or secret backend |
| `environment.delete` | mutation | ADMIN | `{ id: string }` | Delete an environment and all its pipelines and nodes |
| `environment.generateEnrollmentToken` | mutation | ADMIN | `{ environmentId: string }` | Generate a new enrollment token for agent enrollment |
| `environment.revokeEnrollmentToken` | mutation | ADMIN | `{ environmentId: string }` | Revoke the enrollment token |

<details>
<summary>Secret backend options</summary>

The `secretBackend` field accepts one of:

| Value | Description |
|-------|-------------|
| `BUILTIN` | Secrets encrypted in the VectorFlow database (default) |
| `VAULT` | HashiCorp Vault |
| `AWS_SM` | AWS Secrets Manager |
| `EXEC` | External command execution |
</details>

---

## Alert router

Manage alert rules, webhook destinations, and view alert events.

### Alert rules

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `alert.listRules` | query | VIEWER | `{ environmentId: string }` | List alert rules for an environment |
| `alert.createRule` | mutation | EDITOR | `{ name: string, environmentId: string, pipelineId?: string, metric: AlertMetric, condition: AlertCondition, threshold: number, durationSeconds?: number, teamId: string }` | Create an alert rule |
| `alert.updateRule` | mutation | EDITOR | `{ id: string, name?: string, enabled?: boolean, threshold?: number, durationSeconds?: number }` | Update an alert rule |
| `alert.deleteRule` | mutation | EDITOR | `{ id: string }` | Delete an alert rule |

<details>
<summary>AlertMetric values</summary>

| Value | Description |
|-------|-------------|
| `node_unreachable` | Node has not sent a heartbeat |
| `cpu_usage` | Host CPU utilization percentage |
| `memory_usage` | Host memory utilization percentage |
| `disk_usage` | Host disk utilization percentage |
| `error_rate` | Pipeline error events per second |
| `discarded_rate` | Pipeline discarded events per second |
| `pipeline_crashed` | Pipeline process has crashed |
</details>

<details>
<summary>AlertCondition values</summary>

| Value | Description |
|-------|-------------|
| `gt` | Greater than threshold |
| `lt` | Less than threshold |
| `eq` | Equal to threshold |
</details>

### Alert webhooks

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `alert.listWebhooks` | query | VIEWER | `{ environmentId: string }` | List webhook destinations |
| `alert.createWebhook` | mutation | EDITOR | `{ environmentId: string, url: string, headers?: Record<string, string>, hmacSecret?: string }` | Create a webhook |
| `alert.updateWebhook` | mutation | EDITOR | `{ id: string, url?: string, headers?: Record<string, string> \| null, hmacSecret?: string \| null, enabled?: boolean }` | Update a webhook |
| `alert.deleteWebhook` | mutation | EDITOR | `{ id: string }` | Delete a webhook |
| `alert.testWebhook` | mutation | EDITOR | `{ id: string }` | Send a test alert payload to a webhook |

### Alert events

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `alert.listEvents` | query | VIEWER | `{ environmentId: string, limit?: number, cursor?: string }` | Paginated list of alert events |

---

## Template router

Manage reusable pipeline templates.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `template.list` | query | VIEWER | `{ teamId: string }` | List all templates for a team |
| `template.get` | query | VIEWER | `{ id: string }` | Get a template with its nodes and edges |
| `template.create` | mutation | EDITOR | `{ name: string, description: string, category: string, teamId: string, nodes: Node[], edges: Edge[] }` | Create a template |
| `template.delete` | mutation | EDITOR | `{ id: string }` | Delete a template |

---

## Secret router

Manage encrypted secrets for pipeline configurations.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `secret.list` | query | VIEWER | `{ environmentId: string }` | List secrets (names only, no values) |
| `secret.create` | mutation | EDITOR | `{ environmentId: string, name: string, value: string }` | Create a secret |
| `secret.update` | mutation | EDITOR | `{ id: string, environmentId: string, value: string }` | Update a secret value |
| `secret.delete` | mutation | EDITOR | `{ id: string, environmentId: string }` | Delete a secret |

{% hint style="info" %}
Secret values are never returned by the API. The `list` endpoint returns only names and timestamps. Values are encrypted at rest and only decrypted during pipeline deployment.
{% endhint %}

---

## Certificate router

Manage TLS certificates for pipeline components.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `certificate.list` | query | VIEWER | `{ environmentId: string }` | List certificates (metadata only) |
| `certificate.upload` | mutation | EDITOR | `{ environmentId: string, name: string, filename: string, fileType: "ca" \| "cert" \| "key", dataBase64: string }` | Upload a PEM-encoded certificate |
| `certificate.delete` | mutation | EDITOR | `{ id: string, environmentId: string }` | Delete a certificate |

---

## Dashboard router

Fetch dashboard statistics and chart data.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `dashboard.stats` | query | VIEWER | `{ environmentId: string }` | Pipeline count, node count, fleet health, data reduction |
| `dashboard.recentPipelines` | query | VIEWER | *(none)* | Last 5 recently updated pipelines |
| `dashboard.recentAudit` | query | VIEWER | *(none)* | Last 10 audit log entries |
| `dashboard.nodeCards` | query | VIEWER | *(none)* | Node overview cards with metrics and sparklines |
| `dashboard.pipelineCards` | query | VIEWER | `{ environmentId: string }` | Pipeline cards with metrics, rates, and deployment status |
| `dashboard.operationalOverview` | query | VIEWER | *(none)* | Unhealthy nodes, deployed pipelines, recent aggregate metrics |
| `dashboard.chartMetrics` | query | VIEWER | `{ environmentId: string, nodeIds?: string[], pipelineIds?: string[], range?: "1h" \| "6h" \| "1d" \| "7d", groupBy?: "pipeline" \| "node" \| "aggregate" }` | Time-series chart data for dashboards |

---

## Team router

Manage teams and team membership.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `team.list` | query | VIEWER | *(none)* | List teams the current user belongs to |
| `team.get` | query | VIEWER | `{ id: string }` | Get team details with members |
| `team.myRole` | query | VIEWER | *(none)* | Get the current user's highest role |
| `team.teamRole` | query | VIEWER | `{ teamId: string }` | Get the current user's role in a specific team |
| `team.create` | mutation | Super Admin | `{ name: string }` | Create a new team |
| `team.delete` | mutation | Super Admin | `{ teamId: string }` | Delete a team (must have no environments) |
| `team.rename` | mutation | ADMIN | `{ teamId: string, name: string }` | Rename a team |
| `team.addMember` | mutation | ADMIN | `{ teamId: string, email: string, role: "VIEWER" \| "EDITOR" \| "ADMIN" }` | Add a user to a team |
| `team.removeMember` | mutation | ADMIN | `{ teamId: string, userId: string }` | Remove a member from a team |
| `team.updateMemberRole` | mutation | ADMIN | `{ teamId: string, userId: string, role: "VIEWER" \| "EDITOR" \| "ADMIN" }` | Change a member's role |
| `team.lockMember` | mutation | ADMIN | `{ teamId: string, userId: string }` | Lock a user account |
| `team.unlockMember` | mutation | ADMIN | `{ teamId: string, userId: string }` | Unlock a user account |
| `team.resetMemberPassword` | mutation | ADMIN | `{ teamId: string, userId: string }` | Reset a member's password (returns temporary password) |
| `team.updateRequireTwoFactor` | mutation | ADMIN | `{ teamId: string, requireTwoFactor: boolean }` | Require 2FA for all team members |

---

## User router

Manage the current user's profile and two-factor authentication.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `user.me` | query | VIEWER | *(none)* | Get current user info (name, email, auth method, 2FA status) |
| `user.changePassword` | mutation | VIEWER | `{ currentPassword: string, newPassword: string }` | Change password (min 8 characters) |
| `user.updateProfile` | mutation | VIEWER | `{ name: string }` | Update display name |
| `user.setupTotp` | mutation | VIEWER | *(none)* | Begin TOTP 2FA setup (returns QR URI and backup codes) |
| `user.verifyAndEnableTotp` | mutation | VIEWER | `{ code: string }` | Verify a TOTP code and enable 2FA |
| `user.disableTotp` | mutation | VIEWER | `{ code: string }` | Disable 2FA (requires valid TOTP or backup code) |

---

## Audit router

Query the audit log.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `audit.list` | query | VIEWER | `{ action?: string, userId?: string, entityType?: string, search?: string, teamId?: string, environmentId?: string, startDate?: string, endDate?: string, cursor?: string }` | Paginated, filterable audit log |
| `audit.actions` | query | VIEWER | *(none)* | List distinct action values |
| `audit.entityTypes` | query | VIEWER | *(none)* | List distinct entity type values |
| `audit.users` | query | VIEWER | *(none)* | List users who appear in the audit log |

---

## VRL router

Test VRL (Vector Remap Language) expressions.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `vrl.test` | mutation | VIEWER | `{ source: string, input: string }` | Execute a VRL program against a test event and return the result |

---

## VRL Snippet router

Manage the VRL snippet library.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `vrlSnippet.list` | query | VIEWER | `{ teamId: string }` | List built-in and custom VRL snippets |
| `vrlSnippet.create` | mutation | EDITOR | `{ teamId: string, name: string, description?: string, category: string, code: string }` | Create a custom snippet |
| `vrlSnippet.update` | mutation | EDITOR | `{ id: string, name?: string, description?: string, category?: string, code?: string }` | Update a custom snippet |
| `vrlSnippet.delete` | mutation | EDITOR | `{ id: string }` | Delete a custom snippet |

---

## Error handling

tRPC errors are returned with a standard error shape:

```json
{
  "error": {
    "json": {
      "message": "Pipeline not found",
      "code": -32004,
      "data": {
        "code": "NOT_FOUND",
        "httpStatus": 404
      }
    }
  }
}
```

Common error codes:

| tRPC Code | HTTP Status | Meaning |
|-----------|-------------|---------|
| `UNAUTHORIZED` | 401 | Not signed in |
| `FORBIDDEN` | 403 | Insufficient role or not a team member |
| `NOT_FOUND` | 404 | Resource does not exist |
| `BAD_REQUEST` | 400 | Invalid input |
| `CONFLICT` | 409 | Resource already exists (duplicate name) |
| `PRECONDITION_FAILED` | 412 | Operation requires a precondition (e.g., pipeline must be deployed) |

---

## OpenAPI Specification

VectorFlow provides a machine-readable [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) specification covering all REST v1 endpoints and key tRPC procedures.

### Fetching the spec

```bash
curl -s https://vectorflow.example.com/api/v1/openapi.json | jq .info
```

The spec is served at `/api/v1/openapi.json` with CORS enabled — you can fetch it from any origin without credentials.

### Importing into tools

**Postman:** File > Import > paste URL `https://vectorflow.example.com/api/v1/openapi.json`

**Swagger UI / Stoplight:** Point to the spec URL or paste the JSON content.

### Client generation

Generate a typed API client in any language using [openapi-generator](https://openapi-generator.tech/):

```bash
npx @openapitools/openapi-generator-cli generate \
  -i https://vectorflow.example.com/api/v1/openapi.json \
  -g python \
  -o ./vectorflow-client
```

### What's included

The spec documents two API surfaces:

| Surface | Auth | Endpoints |
|---------|------|-----------|
| REST v1 (`/api/v1/*`) | Service account Bearer token | Pipeline CRUD, deploy, rollback, nodes, secrets, alerts, audit |
| tRPC (`/api/trpc/*`) | Session cookie | Pipeline management, fleet, environments, secrets, deploy, alerts, service accounts |

{% hint style="info" %}
**tRPC encoding note:** tRPC endpoints use [SuperJSON](https://github.com/blitz-js/superjson) encoding. For queries, input is URL-encoded JSON in `?input=` (wrap as `{"json": <input>}`). For mutations, the body is `{"json": <input>}`. Using a tRPC client is recommended for full type safety; the OpenAPI spec is provided for discoverability and non-TypeScript integrations.
{% endhint %}

---

## REST API (v1)

The REST API provides a standard HTTP interface for automation and CI/CD. All endpoints require a [Service Account](../operations/service-accounts.md) API key.

### Authentication

Include your API key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer vf_live_abc123..." \
  https://vectorflow.example.com/api/v1/pipelines
```

Responses use standard HTTP status codes and return JSON:

```json
{ "error": "Unauthorized" }     // 401
{ "error": "Forbidden" }        // 403
{ "error": "Pipeline not found" } // 404
```

### Service Account Management

Service accounts are managed via the tRPC API (Settings UI) or programmatically:

| Procedure | Type | Min Role | Description |
|-----------|------|----------|-------------|
| `serviceAccount.list` | query | ADMIN | List service accounts for an environment |
| `serviceAccount.create` | mutation | ADMIN | Create a service account (returns raw key once) |
| `serviceAccount.revoke` | mutation | ADMIN | Disable a service account |
| `serviceAccount.delete` | mutation | ADMIN | Permanently delete a service account |

---

### Pipelines

#### List pipelines

```bash
GET /api/v1/pipelines
```

Permission: `pipelines.read`

Returns all pipelines in the service account's environment.

```bash
curl -s https://vectorflow.example.com/api/v1/pipelines \
  -H "Authorization: Bearer vf_live_..."
```

Response:

```json
{
  "pipelines": [
    {
      "id": "clxyz123",
      "name": "syslog-to-s3",
      "description": "Ship syslog to S3",
      "isDraft": false,
      "deployedAt": "2026-03-01T12:00:00.000Z",
      "createdAt": "2026-02-15T10:00:00.000Z",
      "updatedAt": "2026-03-01T12:00:00.000Z"
    }
  ]
}
```

#### Get pipeline details

```bash
GET /api/v1/pipelines/:id
```

Permission: `pipelines.read`

```bash
curl -s https://vectorflow.example.com/api/v1/pipelines/clxyz123 \
  -H "Authorization: Bearer vf_live_..."
```

#### Deploy pipeline

```bash
POST /api/v1/pipelines/:id/deploy
```

Permission: `pipelines.deploy`

Validates the pipeline config, creates a new version, and marks it as deployed. Agents pick up the change on their next poll.

```bash
curl -s -X POST https://vectorflow.example.com/api/v1/pipelines/clxyz123/deploy \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"changelog": "Deployed from CI"}'
```

Response:

```json
{
  "success": true,
  "versionId": "clversion456",
  "versionNumber": 5
}
```

#### Undeploy pipeline

```bash
POST /api/v1/pipelines/:id/undeploy
```

Permission: `pipelines.deploy`

Marks the pipeline as a draft. Agents stop running it on their next poll.

```bash
curl -s -X POST https://vectorflow.example.com/api/v1/pipelines/clxyz123/undeploy \
  -H "Authorization: Bearer vf_live_..."
```

#### List pipeline versions

```bash
GET /api/v1/pipelines/:id/versions
```

Permission: `pipelines.read`

```bash
curl -s https://vectorflow.example.com/api/v1/pipelines/clxyz123/versions \
  -H "Authorization: Bearer vf_live_..."
```

Response:

```json
{
  "versions": [
    {
      "id": "clversion456",
      "version": 5,
      "changelog": "Added error handling transform",
      "createdById": "user123",
      "createdAt": "2026-03-01T12:00:00.000Z"
    }
  ]
}
```

#### Rollback pipeline

```bash
POST /api/v1/pipelines/:id/rollback
```

Permission: `pipelines.deploy`

Rolls back to a previous version by creating a new version with the target version's config.

```bash
curl -s -X POST https://vectorflow.example.com/api/v1/pipelines/clxyz123/rollback \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"targetVersionId": "clversion123"}'
```

---

### Nodes

#### List nodes

```bash
GET /api/v1/nodes
GET /api/v1/nodes?label=role:production
```

Permission: `nodes.read`

Supports optional label filtering via `?label=key:value`.

```bash
curl -s https://vectorflow.example.com/api/v1/nodes \
  -H "Authorization: Bearer vf_live_..."
```

#### Get node details

```bash
GET /api/v1/nodes/:id
```

Permission: `nodes.read`

```bash
curl -s https://vectorflow.example.com/api/v1/nodes/clnode789 \
  -H "Authorization: Bearer vf_live_..."
```

#### Toggle maintenance mode

```bash
POST /api/v1/nodes/:id/maintenance
```

Permission: `nodes.manage`

```bash
curl -s -X POST https://vectorflow.example.com/api/v1/nodes/clnode789/maintenance \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

---

### Secrets

#### List secrets

```bash
GET /api/v1/secrets
```

Permission: `secrets.read`

Returns secret names and timestamps (never values).

```bash
curl -s https://vectorflow.example.com/api/v1/secrets \
  -H "Authorization: Bearer vf_live_..."
```

#### Create secret

```bash
POST /api/v1/secrets
```

Permission: `secrets.manage`

```bash
curl -s -X POST https://vectorflow.example.com/api/v1/secrets \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "AWS_ACCESS_KEY", "value": "AKIA..."}'
```

#### Update secret

```bash
PUT /api/v1/secrets
```

Permission: `secrets.manage`

Identify the secret by `id` or `name`:

```bash
curl -s -X PUT https://vectorflow.example.com/api/v1/secrets \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "AWS_ACCESS_KEY", "value": "AKIA_NEW..."}'
```

#### Delete secret

```bash
DELETE /api/v1/secrets?name=AWS_ACCESS_KEY
DELETE /api/v1/secrets?id=clsecret123
```

Permission: `secrets.manage`

```bash
curl -s -X DELETE "https://vectorflow.example.com/api/v1/secrets?name=AWS_ACCESS_KEY" \
  -H "Authorization: Bearer vf_live_..."
```

---

### Alert Rules

#### List alert rules

```bash
GET /api/v1/alerts/rules
```

Permission: `alerts.read`

```bash
curl -s https://vectorflow.example.com/api/v1/alerts/rules \
  -H "Authorization: Bearer vf_live_..."
```

#### Create alert rule

```bash
POST /api/v1/alerts/rules
```

Permission: `alerts.manage`

```bash
curl -s -X POST https://vectorflow.example.com/api/v1/alerts/rules \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High CPU Alert",
    "metric": "cpu_usage",
    "condition": "gt",
    "threshold": 80,
    "durationSeconds": 120,
    "teamId": "clteam123"
  }'
```

---

### Audit Log

#### Poll audit events

```bash
GET /api/v1/audit
GET /api/v1/audit?after=cursor123&limit=100&action=deploy.agent
```

Permission: `audit.read`

Supports cursor-based pagination for polling:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `after` | string | -- | Cursor from previous response (for pagination) |
| `limit` | number | 50 | Max events to return (1-200) |
| `action` | string | -- | Filter by action type (e.g., `deploy.agent`) |

```bash
curl -s "https://vectorflow.example.com/api/v1/audit?limit=100" \
  -H "Authorization: Bearer vf_live_..."
```

Response:

```json
{
  "events": [ ... ],
  "cursor": "claudit789",
  "hasMore": true
}
```

To poll for new events, pass the `cursor` from the previous response:

```bash
curl -s "https://vectorflow.example.com/api/v1/audit?after=claudit789&limit=100" \
  -H "Authorization: Bearer vf_live_..."
```
