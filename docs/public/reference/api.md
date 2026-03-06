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

VectorFlow uses [Auth.js](https://authjs.dev/) session cookies for authentication. When you sign in through the web UI, a `authjs.session-token` cookie is set. Include this cookie in API requests.

{% hint style="info" %}
There is no separate API key mechanism. If you need to call the API programmatically, sign in via the UI and extract the session cookie, or use the tRPC client with your session context.
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
| `settings` | `settings.*` | System settings (Super Admin) |
| `admin` | `admin.*` | Admin operations (Super Admin) |
| `metrics` | `metrics.*` | Real-time metric streaming |
| `validator` | `validator.*` | Pipeline config validation |

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
| `componentKey` | `string` | Unique identifier within the pipeline (e.g., `my_syslog_source`). Must match `^[a-zA-Z_][a-zA-Z0-9_]*$` |
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
