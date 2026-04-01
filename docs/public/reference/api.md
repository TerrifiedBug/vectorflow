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

## Admin router

Manage platform users, super admin privileges, and team assignments. All procedures require **Super Admin** access.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `admin.listUsers` | query | Super Admin | *(none)* | List all users with team memberships and auth status |
| `admin.createUser` | mutation | Super Admin | `{ email: string, name: string, teamId?: string, role?: Role }` | Create a local user account (returns generated password) |
| `admin.deleteUser` | mutation | Super Admin | `{ userId: string }` | Delete a user and all their data |
| `admin.toggleSuperAdmin` | mutation | Super Admin | `{ userId: string, isSuperAdmin: boolean }` | Grant or revoke super admin privileges |
| `admin.assignToTeam` | mutation | Super Admin | `{ userId: string, teamId: string, role: "VIEWER" \| "EDITOR" \| "ADMIN" }` | Assign a user to a team with a role |
| `admin.removeFromTeam` | mutation | Super Admin | `{ userId: string, teamId: string }` | Remove a user from a team |
| `admin.lockUser` | mutation | Super Admin | `{ userId: string }` | Lock a user account (prevents sign-in) |
| `admin.unlockUser` | mutation | Super Admin | `{ userId: string }` | Unlock a locked user account |
| `admin.resetPassword` | mutation | Super Admin | `{ userId: string }` | Generate a temporary password for a user |
| `admin.listTeams` | query | Super Admin | *(none)* | List all teams |

---

## Settings router

Configure system-wide settings. All procedures require **Super Admin** access except `checkVersion`.

### General

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `settings.get` | query | Super Admin | *(none)* | Get all system settings (secrets are masked) |
| `settings.checkVersion` | query | VIEWER | `{ force?: boolean }` | Check server, agent, and dev agent versions |

### OIDC

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `settings.testOidc` | mutation | Super Admin | `{ issuer: string }` | Test OIDC provider discovery |
| `settings.updateOidc` | mutation | Super Admin | `{ issuer: string, clientId: string, clientSecret: string, displayName?: string, tokenEndpointAuthMethod?: string }` | Update OIDC provider configuration |
| `settings.updateOidcRoleMapping` | mutation | Super Admin | `{ defaultRole: Role, groupsClaim?: string, adminGroups?: string[], editorGroups?: string[] }` | Map OIDC groups to VectorFlow roles |
| `settings.updateOidcTeamMappings` | mutation | Super Admin | `{ mappings: TeamMapping[], defaultTeamId?: string, defaultRole: Role, groupSyncEnabled: boolean, groupsScope?: string, groupsClaim?: string }` | Map OIDC groups to teams with roles |

<details>
<summary>TeamMapping schema</summary>

Each entry in the `mappings` array:

| Field | Type | Description |
|-------|------|-------------|
| `group` | `string` | OIDC group name to match |
| `teamId` | `string` | VectorFlow team to map to |
| `role` | `"VIEWER" \| "EDITOR" \| "ADMIN"` | Role to assign in that team |
</details>

### Fleet

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `settings.updateFleet` | mutation | Super Admin | `{ pollIntervalMs: number, unhealthyThreshold: number, metricsRetentionDays?: number, logsRetentionDays?: number }` | Update fleet polling interval and data retention |

### Anomaly detection

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `settings.updateAnomalyConfig` | mutation | Super Admin | `{ baselineWindowDays: number, sigmaThreshold: number, minStddevFloorPercent: number, dedupWindowHours: number, enabledMetrics: string[] }` | Configure anomaly detection parameters |

### Backup & restore

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `settings.createBackup` | mutation | Super Admin | *(none)* | Create a database backup |
| `settings.listBackups` | query | Super Admin | *(none)* | List available backups |
| `settings.previewBackup` | query | Super Admin | `{ filename: string }` | Preview backup contents |
| `settings.deleteBackup` | mutation | Super Admin | `{ filename: string }` | Delete a backup file |
| `settings.restoreBackup` | mutation | Super Admin | `{ filename: string }` | Restore the database from a backup |
| `settings.updateBackupSchedule` | mutation | Super Admin | `{ enabled: boolean, cron: string, retentionCount: number }` | Configure automatic backup schedule |

### Storage backend

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `settings.testS3Connection` | mutation | Super Admin | `{ bucket: string, region: string, prefix?: string, accessKeyId: string, secretAccessKey: string, endpoint?: string }` | Test S3 bucket connectivity |
| `settings.updateStorageBackend` | mutation | Super Admin | `{ backend: "local" \| "s3", bucket?: string, region?: string, prefix?: string, accessKeyId?: string, secretAccessKey?: string, endpoint?: string }` | Switch backup storage between local filesystem and S3 |

### SCIM

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `settings.updateScim` | mutation | Super Admin | `{ enabled: boolean }` | Enable or disable SCIM provisioning |
| `settings.generateScimToken` | mutation | Super Admin | *(none)* | Generate a new SCIM bearer token |

---

## Metrics router

Query pipeline and component metrics from both the database (historical) and in-memory store (live).

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `metrics.getPipelineMetrics` | query | VIEWER | `{ pipelineId: string, minutes?: number }` | Aggregated pipeline metrics from database (default 60 min, max 10080) |
| `metrics.getComponentMetrics` | query | VIEWER | `{ pipelineId: string, minutes?: number }` | Live per-component metrics from in-memory store (default 5 min, max 60) |
| `metrics.getComponentLatencyHistory` | query | VIEWER | `{ pipelineId: string, minutes?: number }` | Per-component latency time series from database (default 60 min, max 1440) |
| `metrics.getNodePipelineRates` | query | VIEWER | `{ nodeId: string }` | Per-pipeline event and byte rates for a specific node |
| `metrics.getLiveRates` | query | VIEWER | `{ environmentId: string }` | Per-pipeline live event and byte rates for the pipelines table |

---

## Analytics router

Cost analytics and data volume tracking for pipelines, teams, and environments.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `analytics.costSummary` | query | VIEWER | `{ environmentId: string, range: Range }` | Aggregated cost summary for KPI cards |
| `analytics.costByPipeline` | query | VIEWER | `{ environmentId: string, range: Range }` | Per-pipeline cost breakdown table |
| `analytics.topPipelines` | query | VIEWER | `{ environmentId: string, range: Range }` | Top 5 pipelines by bytes processed |
| `analytics.costByTeam` | query | VIEWER | `{ environmentId: string, range: Range }` | Team-level cost rollup for chargeback (super admins see all teams) |
| `analytics.costByEnvironment` | query | VIEWER | `{ environmentId: string, range: Range }` | Environment comparison view |
| `analytics.costTimeSeries` | query | VIEWER | `{ environmentId: string, range: Range, groupBy?: "pipeline" \| "team" }` | Volume trend time series, grouped by pipeline or team |
| `analytics.costCsv` | query | VIEWER | `{ environmentId: string, range: Range }` | Export cost data as CSV |

<details>
<summary>Range values</summary>

All analytics queries accept the same range parameter:

| Value | Description |
|-------|-------------|
| `1h` | Last hour |
| `6h` | Last 6 hours |
| `1d` | Last 24 hours |
| `7d` | Last 7 days |
| `30d` | Last 30 days |
</details>

---

## Anomaly router

View and manage anomaly detection events. Anomalies are automatically detected based on the [anomaly configuration](#anomaly-detection) in system settings.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `anomaly.list` | query | VIEWER | `{ environmentId: string, pipelineId?: string, status?: "open" \| "acknowledged" \| "dismissed", limit?: number, cursor?: string }` | Paginated list of anomalies with optional filters |
| `anomaly.countByPipeline` | query | VIEWER | `{ environmentId: string }` | Count of open anomalies per pipeline |
| `anomaly.maxSeverityByPipeline` | query | VIEWER | `{ environmentId: string }` | Maximum severity level per pipeline |
| `anomaly.acknowledge` | mutation | EDITOR | `{ environmentId: string, anomalyId: string }` | Acknowledge an anomaly |
| `anomaly.dismiss` | mutation | EDITOR | `{ environmentId: string, anomalyId: string }` | Dismiss an anomaly |

---

## Cost Recommendation router

View and act on cost optimization recommendations generated by automated analysis.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `costRecommendation.list` | query | VIEWER | `{ environmentId: string, status?: "PENDING" \| "DISMISSED" \| "APPLIED", limit?: number }` | List cost recommendations with optional status filter |
| `costRecommendation.getById` | query | VIEWER | `{ environmentId: string, id: string }` | Get a recommendation with affected pipeline nodes |
| `costRecommendation.summary` | query | VIEWER | `{ environmentId: string }` | Summary stats — pending count and estimated savings |
| `costRecommendation.dismiss` | mutation | EDITOR | `{ environmentId: string, id: string }` | Dismiss a recommendation |
| `costRecommendation.markApplied` | mutation | EDITOR | `{ environmentId: string, id: string }` | Mark a recommendation as applied |
| `costRecommendation.triggerAnalysis` | mutation | ADMIN | `{ environmentId: string }` | Manually trigger cost analysis |

---

## Validator router

Validate pipeline configuration YAML.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `validator.validate` | mutation | VIEWER | `{ yaml: string }` | Validate a YAML configuration string and return any errors |

---

## Pipeline Group router

Organize pipelines into nested folder groups (max 3 levels deep).

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `pipelineGroup.list` | query | VIEWER | `{ environmentId: string }` | List all pipeline groups in an environment |
| `pipelineGroup.create` | mutation | EDITOR | `{ environmentId: string, name: string, color?: string, parentId?: string }` | Create a pipeline group (unique name per parent, max 3-level nesting) |
| `pipelineGroup.update` | mutation | EDITOR | `{ id: string, name?: string, color?: string, parentId?: string }` | Update group name, color, or parent |
| `pipelineGroup.delete` | mutation | ADMIN | `{ id: string }` | Delete a group (child groups are orphaned to root) |

---

## Pipeline Dependency router

Define and query dependencies between pipelines. Used to warn before deploying or undeploying pipelines with active dependencies.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `pipelineDependency.list` | query | VIEWER | `{ pipelineId: string }` | List upstream dependencies for a pipeline |
| `pipelineDependency.listCandidates` | query | VIEWER | `{ pipelineId: string, environmentId: string }` | List pipelines available to link as dependencies |
| `pipelineDependency.add` | mutation | EDITOR | `{ upstreamId: string, downstreamId: string, description?: string }` | Add a dependency between two pipelines |
| `pipelineDependency.remove` | mutation | EDITOR | `{ id: string }` | Remove a dependency |
| `pipelineDependency.deployWarnings` | query | VIEWER | `{ pipelineId: string }` | List undeployed upstream dependencies (deploy warnings) |
| `pipelineDependency.undeployWarnings` | query | VIEWER | `{ pipelineId: string }` | List deployed downstream dependents (undeploy warnings) |
| `pipelineDependency.graph` | query | VIEWER | `{ environmentId: string }` | Full dependency graph for an environment |

---

## Promotion router

Promote pipelines across environments with an optional approval workflow.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `promotion.preflight` | query | VIEWER | `{ pipelineId: string, targetEnvironmentId: string, name?: string }` | Check promotion readiness — missing secrets, name collisions |
| `promotion.diffPreview` | query | VIEWER | `{ pipelineId: string }` | Generate a YAML diff between source and target |
| `promotion.initiate` | mutation | EDITOR | `{ pipelineId: string, targetEnvironmentId: string, name?: string }` | Initiate a promotion request |
| `promotion.approve` | mutation | EDITOR | `{ requestId: string }` | Approve a pending promotion (self-approval blocked) |
| `promotion.reject` | mutation | EDITOR | `{ requestId: string, note?: string }` | Reject a pending promotion |
| `promotion.cancel` | mutation | EDITOR | `{ requestId: string }` | Cancel a promotion (only the original promoter) |
| `promotion.history` | query | VIEWER | `{ pipelineId: string }` | List promotion history (last 20 requests) |

<details>
<summary>Promotion statuses</summary>

| Status | Description |
|--------|-------------|
| `PENDING` | Awaiting approval from another team member |
| `DEPLOYED` | Auto-approved and deployed to the target environment |
| `AWAITING_PR_MERGE` | GitOps mode — waiting for the generated PR to be merged |
| `REJECTED` | Rejected by a reviewer |
| `CANCELLED` | Cancelled by the original promoter |
</details>

---

## Staged Rollout router

Perform canary deployments by rolling out pipeline changes to a subset of nodes before broadening to the full fleet.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `stagedRollout.create` | mutation | EDITOR | `{ pipelineId: string, canarySelector: object, healthCheckWindowMinutes: number, changelog: string }` | Create a staged rollout (deploys to canary nodes first) |
| `stagedRollout.broaden` | mutation | EDITOR | `{ rolloutId: string }` | Broaden the rollout to additional nodes |
| `stagedRollout.rollback` | mutation | EDITOR | `{ rolloutId: string }` | Roll back the staged rollout |
| `stagedRollout.getActive` | query | VIEWER | `{ pipelineId: string }` | Get the active rollout for a pipeline (if any) |
| `stagedRollout.list` | query | VIEWER | `{ pipelineId: string }` | List recent rollouts (last 10) |

<details>
<summary>Rollout statuses</summary>

| Status | Description |
|--------|-------------|
| `CANARY_DEPLOYED` | Deployed to canary nodes, awaiting health check or broadening |
| `HEALTH_CHECK` | Health check window in progress |
| `BROADENED` | Rolled out to all nodes |
| `ROLLED_BACK` | Rolled back to previous version |
</details>

---

## Node Group router

Organize fleet nodes into groups based on label criteria. Groups provide aggregated health statistics and compliance tracking.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `nodeGroup.list` | query | VIEWER | `{ environmentId: string }` | List node groups in an environment |
| `nodeGroup.create` | mutation | ADMIN | `{ environmentId: string, name: string, criteria: Record<string, string>, labelTemplate?: Record<string, string>, requiredLabels?: string[] }` | Create a node group with label-based membership criteria |
| `nodeGroup.update` | mutation | ADMIN | `{ id: string, name?: string, criteria?: Record<string, string>, labelTemplate?: Record<string, string>, requiredLabels?: string[] }` | Update group properties |
| `nodeGroup.delete` | mutation | ADMIN | `{ id: string }` | Delete a node group |
| `nodeGroup.groupHealthStats` | query | VIEWER | `{ environmentId: string }` | Aggregated health stats per group (includes `__ungrouped__` synthetic entry) |
| `nodeGroup.nodesInGroup` | query | VIEWER | `{ groupId: string, environmentId: string }` | List nodes in a group with status, labels, and compliance info |

---

## Service Account router

Manage service accounts for programmatic API access via the [REST API](#rest-api-v1).

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `serviceAccount.list` | query | ADMIN | `{ environmentId: string }` | List service accounts for an environment |
| `serviceAccount.create` | mutation | ADMIN | `{ environmentId: string, name: string, description?: string, permissions: Permission[], expiresInDays?: number }` | Create a service account (returns the raw API key once) |
| `serviceAccount.revoke` | mutation | ADMIN | `{ id: string }` | Disable a service account |
| `serviceAccount.delete` | mutation | ADMIN | `{ id: string }` | Permanently delete a service account |

<details>
<summary>Permission values</summary>

| Permission | Description |
|------------|-------------|
| `pipelines.read` | Read pipeline definitions, versions, and metrics |
| `pipelines.deploy` | Deploy, undeploy, and rollback pipelines |
| `nodes.read` | Read node status, logs, and metrics |
| `nodes.manage` | Manage nodes (maintenance mode, updates) |
| `secrets.read` | List secret names |
| `secrets.manage` | Create, update, and delete secrets |
| `alerts.read` | Read alert rules and events |
| `alerts.manage` | Create, update, and delete alert rules |
| `audit.read` | Read audit log |
</details>

{% hint style="info" %}
The raw API key is only returned once during creation. Store it securely — it cannot be retrieved later. Keys are prefixed with `vf_` and hashed (SHA-256) before storage.
{% endhint %}

---

## Webhook Endpoint router

Manage outbound webhook endpoints for alert notifications. See also [Outbound Webhooks](../operations/outbound-webhooks.md).

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `webhookEndpoint.list` | query | VIEWER | `{ teamId: string }` | List webhook endpoints (secrets excluded) |
| `webhookEndpoint.create` | mutation | ADMIN | `{ teamId: string, name: string, url: string, eventTypes: AlertMetric[], secret?: string }` | Create a webhook endpoint (secret is encrypted at rest) |
| `webhookEndpoint.update` | mutation | ADMIN | `{ id: string, teamId: string, name?: string, url?: string, eventTypes?: AlertMetric[], secret?: string }` | Update a webhook endpoint |
| `webhookEndpoint.delete` | mutation | ADMIN | `{ id: string, teamId: string }` | Delete a webhook endpoint and its delivery history |
| `webhookEndpoint.toggleEnabled` | mutation | ADMIN | `{ id: string, teamId: string }` | Toggle the endpoint enabled/disabled |
| `webhookEndpoint.testDelivery` | mutation | ADMIN | `{ id: string, teamId: string }` | Send a test delivery to the endpoint |
| `webhookEndpoint.listDeliveries` | query | VIEWER | `{ webhookEndpointId: string, teamId: string, take?: number, skip?: number }` | Paginated delivery history (default 20, max 100) |

---

## Git Sync router

Monitor and manage GitOps synchronization. See also [GitOps](../operations/gitops.md).

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `gitSync.status` | query | VIEWER | `{ environmentId: string }` | Get sync status summary (repo URL, branch, mode, pending/failed counts, last sync) |
| `gitSync.jobs` | query | VIEWER | `{ environmentId: string, status?: "pending" \| "completed" \| "failed", limit?: number }` | List recent sync jobs (default 25, max 100) |
| `gitSync.retryJob` | mutation | EDITOR | `{ jobId: string }` | Retry a single failed sync job |
| `gitSync.retryAllFailed` | mutation | EDITOR | `{ environmentId: string }` | Retry all failed sync jobs |
| `gitSync.importErrors` | query | VIEWER | `{ environmentId: string, limit?: number }` | Get recent import errors from the audit log (default 10, max 50) |

---

## Migration router

Migrate pipeline configurations from other platforms to VectorFlow. Currently supports Fluentd.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `migration.list` | query | VIEWER | `{ teamId: string }` | List migration projects for a team |
| `migration.get` | query | VIEWER | `{ id: string, teamId: string }` | Get a migration project with its blocks and status |
| `migration.create` | mutation | EDITOR | `{ teamId: string, name: string, platform: "FLUENTD", originalConfig: string }` | Create a migration project (config max 500 KB) |
| `migration.delete` | mutation | EDITOR | `{ id: string, teamId: string }` | Delete a migration project |
| `migration.parse` | mutation | EDITOR | `{ id: string, teamId: string }` | Parse the original config into translatable blocks |
| `migration.translate` | mutation | EDITOR | `{ id: string, teamId: string }` | Translate all blocks to Vector config via AI |
| `migration.retranslateBlock` | mutation | EDITOR | `{ id: string, teamId: string, blockId: string }` | Re-translate a single block |
| `migration.updateBlockConfig` | mutation | EDITOR | `{ id: string, teamId: string, blockId: string, config: Record<string, unknown> }` | Manually edit a translated block's config |
| `migration.validate` | mutation | EDITOR | `{ id: string, teamId: string }` | Validate the translated configuration |
| `migration.generate` | mutation | EDITOR | `{ id: string, teamId: string, environmentId: string, pipelineName: string }` | Generate a VectorFlow pipeline from the translated config |

{% hint style="info" %}
The `translate` procedure requires an AI provider to be configured for the team. The migration workflow is: **create** → **parse** → **translate** → (optional: edit blocks) → **validate** → **generate**.
{% endhint %}

---

## AI router

Manage AI assistant conversations for pipeline building, debugging, and VRL authoring.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `aiRouter.getConversation` | query | VIEWER | `{ pipelineId: string }` | Get the AI conversation for a pipeline |
| `aiRouter.startNewConversation` | mutation | EDITOR | `{ pipelineId: string }` | Start a new AI conversation (replaces existing) |
| `aiRouter.markSuggestionsApplied` | mutation | EDITOR | `{ pipelineId: string, conversationId: string, messageId: string, suggestionIds: string[] }` | Mark AI suggestions as applied to the pipeline |
| `aiRouter.getDebugConversation` | query | VIEWER | `{ pipelineId: string }` | Get the debug-mode AI conversation |
| `aiRouter.getVrlConversation` | query | VIEWER | `{ pipelineId: string, componentKey: string }` | Get the VRL assistant conversation for a component |
| `aiRouter.markVrlSuggestionsApplied` | mutation | EDITOR | `{ pipelineId: string, conversationId: string, messageId: string, suggestionIds: string[] }` | Mark VRL suggestions as applied |

---

## User Preference router

Store and retrieve per-user UI preferences (e.g., theme, default views, collapsed sidebar sections).

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `userPreference.get` | query | VIEWER | *(none)* | Get all preferences for the current user |
| `userPreference.set` | mutation | VIEWER | `{ key: string, value: string }` | Set a preference (key max 100 chars, value max 500 chars) |
| `userPreference.delete` | mutation | VIEWER | `{ key: string }` | Delete a preference |

---

## Shared Component router

Manage reusable pipeline components that can be linked across multiple pipelines. When a shared component is updated, linked pipelines show a staleness indicator until the update is accepted.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `sharedComponent.list` | query | VIEWER | `{ environmentId: string }` | List shared components with linked pipeline count |
| `sharedComponent.getById` | query | VIEWER | `{ id: string, environmentId: string }` | Get a component with linked pipeline details and staleness info |
| `sharedComponent.create` | mutation | EDITOR | `{ environmentId: string, name: string, description?: string, componentType: string, kind: "SOURCE" \| "TRANSFORM" \| "SINK", config: object }` | Create a shared component |
| `sharedComponent.createFromNode` | mutation | EDITOR | `{ nodeId: string, pipelineId: string, name: string, description?: string, environmentId: string }` | Create a shared component from an existing pipeline node |
| `sharedComponent.update` | mutation | EDITOR | `{ id: string, environmentId: string, name?: string, description?: string, config?: object }` | Update a shared component (config changes bump the version) |
| `sharedComponent.delete` | mutation | EDITOR | `{ id: string, environmentId: string }` | Delete a shared component |
| `sharedComponent.acceptUpdate` | mutation | EDITOR | `{ nodeId: string, pipelineId: string }` | Accept the latest shared component config for a single node |
| `sharedComponent.acceptUpdateBulk` | mutation | EDITOR | `{ pipelineId: string }` | Accept updates for all stale nodes in a pipeline |
| `sharedComponent.unlink` | mutation | EDITOR | `{ nodeId: string, pipelineId: string }` | Unlink a node from its shared component (keeps current config) |
| `sharedComponent.linkExisting` | mutation | EDITOR | `{ nodeId: string, pipelineId: string, sharedComponentId: string }` | Link a node to an existing shared component |

---

## Filter Preset router

Save and manage filter presets for the pipeline list and fleet matrix views.

| Procedure | Type | Min Role | Input | Description |
|-----------|------|----------|-------|-------------|
| `filterPreset.list` | query | VIEWER | `{ environmentId: string, scope: "pipeline_list" \| "fleet_matrix" }` | List filter presets for a scope |
| `filterPreset.create` | mutation | EDITOR | `{ environmentId: string, name: string, scope: "pipeline_list" \| "fleet_matrix", filters: Record<string, unknown>, isDefault?: boolean }` | Create a filter preset (max 20 per scope) |
| `filterPreset.update` | mutation | EDITOR | `{ environmentId: string, id: string, name?: string, filters?: Record<string, unknown> }` | Update a preset |
| `filterPreset.delete` | mutation | EDITOR | `{ environmentId: string, id: string }` | Delete a preset |
| `filterPreset.setDefault` | mutation | EDITOR | `{ environmentId: string, id: string, scope: "pipeline_list" \| "fleet_matrix" }` | Set a preset as the default for its scope |
| `filterPreset.clearDefault` | mutation | EDITOR | `{ environmentId: string, scope: "pipeline_list" \| "fleet_matrix" }` | Clear the default preset for a scope |

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
