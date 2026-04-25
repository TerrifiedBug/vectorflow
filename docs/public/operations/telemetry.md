# Telemetry

VectorFlow can send anonymous, aggregate usage stats to a centralised receiver to help the maintainer understand how it's used and prioritise improvements. This is **opt-in** — VectorFlow does not send any data unless you explicitly turn it on.

## What is collected

When telemetry is enabled, VectorFlow sends a single JSON payload **once per day** to `https://pulse.terrifiedbug.com/api/v1/ping`. The payload contains:

| Field | Source | Why |
|---|---|---|
| `schema_version` | hardcoded `1` | lets the receiver evolve without breaking old clients |
| `instance_id` | random ULID generated when you first opt in | a stable identifier for your installation. Anonymous — not linked to any user, organisation, or hostname. |
| `instance_created_at` | timestamp of your first opt-in | cohort tracking — lets us see retention over time |
| `sent_at` | current timestamp | when the heartbeat was sent |
| `vf_version` | `process.env.VF_VERSION` (or `"unknown"`) | which version of VectorFlow you're running |
| `agent_count` | row count of the agents table | scale signal — how many fleet agents are managed |
| `pipeline_count` | grouped row counts of the pipelines table | `{ active, paused, draft }` — scale and lifecycle signal |
| `auth_method` | derived from OIDC issuer setting | `"credentials"` or `"oidc"` — informs which auth path matters |
| `deployment_mode` | `process.env.VF_DEPLOYMENT_MODE` (or `"unknown"`) | `"docker"`, `"helm"`, `"bare"`, or `"unknown"` |

### What is NOT collected

- Hostnames, IP addresses (the receiver's IP-based country lookup is server-side only — your IP is never stored, only a hash for rate limiting)
- Pipeline names, configurations, or VRL code
- User emails, names, or identifiers
- Source/sink endpoint URLs (Kafka brokers, S3 buckets, syslog servers, etc.)
- Any data flowing through your pipelines

## Example payload

```json
{
  "schema_version": 1,
  "instance_id": "01HX0000000000000000000000",
  "instance_created_at": "2026-04-25T10:00:00.000Z",
  "sent_at": "2026-04-26T03:42:00.000Z",
  "vf_version": "1.4.2",
  "agent_count": 5,
  "pipeline_count": { "active": 12, "paused": 2, "draft": 3 },
  "auth_method": "credentials",
  "deployment_mode": "docker"
}
```

## How to opt out

In VectorFlow, go to **Settings → Telemetry** and turn the toggle off. Telemetry stops immediately. Your instance ID is preserved in case you re-enable later (so you appear as the same anonymous instance, not a new one).

You can also choose "No thanks" during initial setup if you want telemetry off from day one.

## Receiver source

The telemetry receiver is private. Its data-handling code is documented in its own `PRIVACY.md`. No telemetry data is shared per-instance publicly — only aggregate counts on a community stats dashboard.
