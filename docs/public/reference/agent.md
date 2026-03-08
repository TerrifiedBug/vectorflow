# Agent Reference

The VectorFlow agent is a lightweight Go binary that runs on each node where you want to execute Vector pipelines. It has zero external dependencies -- a single binary is all you need. The agent communicates with the VectorFlow server to receive pipeline configurations, report status and metrics, and apply updates.

## Overview

- **Single binary**: No runtime dependencies, no package managers. Download and run.
- **Zero config files**: All configuration is via environment variables.
- **Process-per-pipeline**: Each deployed pipeline runs as a separate Vector child process, providing isolation and independent lifecycle management.
- **Stateless**: The agent stores only its node token on disk. All pipeline configuration comes from the server on every poll.

---

## Lifecycle

The agent follows a predictable lifecycle from first startup to steady-state operation:

```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌────────────┐
│  Start   │───▶│  Enroll  │───▶│  Poll + Run  │───▶│  Heartbeat │
│          │    │          │    │              │    │            │
│ Load env │    │ Send     │    │ Fetch config │    │ Report     │
│ vars,    │    │ hostname │    │ Start/stop   │    │ pipeline   │
│ detect   │    │ + token  │    │ pipelines    │    │ status,    │
│ Vector   │    │ to server│    │              │    │ metrics,   │
└──────────┘    └──────────┘    └──────────────┘    │ logs       │
                     │                  ▲            └─────┬──────┘
                     │                  │                  │
                     │                  └──────────────────┘
                     │                     (every poll interval)
                     │
               ┌─────▼──────┐
               │ Save node  │
               │ token to   │
               │ disk       │
               └────────────┘
```

### Enrollment

On first startup, the agent enrolls with the server using the enrollment token (`VF_TOKEN`). The server responds with a **node token** -- a unique credential for this specific agent instance. The node token is saved to `<VF_DATA_DIR>/node-token` and reused on subsequent starts. After enrollment, the `VF_TOKEN` is no longer needed.

The enrollment request includes the agent's hostname, OS/architecture, agent version, and Vector version.

### Polling

After enrollment, the agent enters a poll loop. On each tick (default: every 15 seconds), it:

1. **Fetches configuration** from the server (`GET /api/agent/config`)
2. **Compares** the received pipeline configs against locally known state (by checksum)
3. **Takes action**: starts new pipelines, restarts pipelines with changed configs, stops removed pipelines
4. **Reconciles** orphaned config files on disk from previous runs
5. **Processes** any pending sample requests or server-initiated actions (e.g., self-update)

### Heartbeat

After each poll, the agent sends a heartbeat (`POST /api/agent/heartbeat`) that includes:

- Status of each running pipeline (RUNNING, STARTING, STOPPED, CRASHED)
- Per-pipeline metrics scraped from Vector's Prometheus endpoint (events in/out, bytes, errors)
- Per-component metrics for the visual editor node overlays
- Host system metrics (CPU, memory, disk, network)
- Recent stdout/stderr log lines from each pipeline process
- Agent and Vector version information
- Node labels (optional key-value metadata for selective deployment)

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VF_URL` | Yes | -- | VectorFlow server URL (e.g., `https://vectorflow.example.com`) |
| `VF_TOKEN` | On first run | -- | Enrollment token from the VectorFlow UI. Not needed after initial enrollment. |
| `VF_DATA_DIR` | No | `/var/lib/vf-agent` | Directory for node token, pipeline configs, and certificate files |
| `VF_VECTOR_BIN` | No | `vector` | Path to the Vector binary. Use if Vector is not on the system `PATH`. |
| `VF_POLL_INTERVAL` | No | `15s` | How often to poll the server for config changes. Accepts Go duration syntax (e.g., `10s`, `1m`). |
| `VF_LOG_LEVEL` | No | `info` | Agent log level: `debug`, `info`, `warn`, `error` |
| `VF_LABELS` | No | -- | Comma-separated key=value pairs reported to the server on each heartbeat (e.g., `region=us-east-1,tier=production`). Labels set via the UI take precedence over agent-reported values. Used for selective pipeline deployment. |

{% hint style="warning" %}
`VF_URL` is the only strictly required variable. However, `VF_TOKEN` must be set on the first run for enrollment. After the agent writes its node token to disk, `VF_TOKEN` can be removed.
{% endhint %}

---

## CLI flags

The agent accepts the following flags:

| Flag | Description |
|------|-------------|
| `--version`, `-v` | Print the agent version and exit |
| `--help`, `-h` | Show usage help including the environment variable reference |
| `--channel <name>` | Set the update channel: `stable` (default) or `dev`. Dev channel agents receive pre-release binaries and are tracked separately in the fleet UI. |

All runtime configuration is via environment variables -- there are no flags for server URL, token, etc.

---

## Agent communication protocol

The agent communicates with the VectorFlow server over three HTTP endpoints. All requests use JSON. Authenticated requests include the node token as a Bearer token.

### `POST /api/agent/enroll`

Called once on first startup. No authentication required (the enrollment token is in the request body).

**Request:**
```json
{
  "token": "vf_enroll_abc123...",
  "hostname": "web-server-01",
  "os": "linux/amd64",
  "agentVersion": "0.5.0",
  "vectorVersion": "vector 0.41.1 (x86_64-unknown-linux-gnu)"
}
```

**Response:**
```json
{
  "nodeId": "clxyz789",
  "nodeToken": "vfn_abc123...",
  "environmentId": "clxyz456",
  "environmentName": "Production"
}
```

### `GET /api/agent/config`

Called on every poll cycle. Returns all deployed pipeline configurations for this node's environment.

**Headers:** `Authorization: Bearer <node-token>`

**Response:**
```json
{
  "pipelines": [
    {
      "pipelineId": "clxyz001",
      "pipelineName": "syslog-to-s3",
      "version": 3,
      "configYaml": "sources:\n  syslog_in:\n    type: syslog\n    ...",
      "checksum": "sha256:abc123...",
      "logLevel": "info",
      "secrets": {
        "VF_SECRET_AWS_KEY": "AKIAIOSFODNN7EXAMPLE"
      },
      "certFiles": [
        {
          "name": "ca-cert",
          "filename": "ca.pem",
          "data": "<base64-encoded PEM>"
        }
      ]
    }
  ],
  "pollIntervalMs": 15000,
  "secretBackend": "BUILTIN",
  "sampleRequests": [],
  "pendingAction": null
}
```

Key fields:
- **`configYaml`**: The generated Vector YAML. Secret references are converted to environment variable placeholders (e.g., `${VF_SECRET_AWS_KEY}`) rather than containing decrypted values.
- **`secrets`**: Pre-resolved secret values keyed by their `VF_SECRET_` environment variable name. The agent injects these as environment variables into the Vector process, where Vector's interpolation resolves the placeholders.
- **`checksum`**: Includes both the YAML and the secrets dictionary, so rotating a secret triggers a pipeline restart even if the YAML itself hasn't changed.
- **`certFiles`**: Certificate data written to `<VF_DATA_DIR>/certs/` before starting the pipeline.
- **`pendingAction`**: Server-initiated action (currently only `self_update`).

{% hint style="info" %}
When a pipeline has a **node selector** configured (via the deploy dialog), the config response only includes pipelines whose selector labels match this node's labels. A pipeline with no node selector deploys to all nodes.
{% endhint %}

{% hint style="info" %}
When a node is in **maintenance mode**, the config response returns an empty `pipelines` array. The agent stops all running pipelines but continues sending heartbeats. See [Fleet Management](../user-guide/fleet.md#maintenance-mode) for details.
{% endhint %}

### `POST /api/agent/heartbeat`

Called after every poll. Sends status and metrics for all managed pipelines.

**Headers:** `Authorization: Bearer <node-token>`, `Content-Type: application/json`

Key fields:
- **`labels`** (optional): Key-value pairs describing this node. Labels set via the `VF_LABELS` environment variable are reported here. The server merges them with any labels set through the UI, with UI-set labels taking precedence.

**Request:**
```json
{
  "pipelines": [
    {
      "pipelineId": "clxyz001",
      "version": 3,
      "status": "RUNNING",
      "pid": 12345,
      "uptimeSeconds": 3600,
      "eventsIn": 150000,
      "eventsOut": 148500,
      "bytesIn": 75000000,
      "bytesOut": 72000000,
      "errorsTotal": 12,
      "componentMetrics": [
        {
          "componentId": "syslog_in",
          "componentKind": "source",
          "receivedEvents": 150000,
          "sentEvents": 150000,
          "receivedBytes": 75000000
        }
      ],
      "recentLogs": ["2025-01-15T10:30:00Z INFO vector: Pipeline running"]
    }
  ],
  "hostMetrics": {
    "memoryTotalBytes": 8589934592,
    "memoryUsedBytes": 4294967296,
    "cpuSecondsTotal": 12345.67,
    "loadAvg1": 1.5
  },
  "agentVersion": "0.5.0",
  "vectorVersion": "vector 0.41.1",
  "deploymentMode": "STANDALONE",
  "labels": {
    "region": "us-east-1",
    "tier": "production"
  }
}
```

---

## Process supervision

The agent manages Vector processes with full lifecycle control:

- **Start**: Spawns `vector --config <pipeline>.yaml --config <pipeline>.yaml.vf-metrics.yaml`. The second config file is a sidecar that adds internal metrics, host metrics, a Prometheus exporter, and the Vector API.
- **Stop**: Sends `SIGTERM`, waits up to 30 seconds for graceful shutdown, then sends `SIGKILL` if needed.
- **Restart**: Stops the running process then starts a new one with the updated config.
- **Crash recovery**: If a Vector process exits unexpectedly, the agent automatically restarts it with exponential backoff (1s, 2s, 4s, ... up to 60s).

### Environment injection

Each Vector process receives:
- `VECTOR_LOG=<logLevel>` -- controls Vector's log verbosity
- All resolved secrets as environment variables with `VF_SECRET_` prefix (e.g., `VF_SECRET_AWS_KEY=value`)

Pipeline YAML references secrets as `${VF_SECRET_NAME}` placeholders. Vector's built-in environment variable interpolation resolves these at startup, so secret values never appear in configuration files on disk.

### Metrics sidecar

The agent automatically generates a sidecar config for each pipeline that adds:
- `vf_internal_metrics` source (Vector internal metrics)
- `vf_host_metrics` source (host system metrics)
- `vf_metrics_exporter` sink (Prometheus exporter on a dynamic port)
- Vector API enabled on `127.0.0.1:<dynamic-port>`

The agent scrapes the Prometheus endpoint on each heartbeat to collect per-component and host metrics.

---

## Auto-update mechanism

Standalone agents (not Docker) support in-place binary updates:

1. An admin triggers an update from the VectorFlow UI, specifying a target version and download URL
2. The server stores a `pendingAction` of type `self_update` on the node
3. On the next poll, the agent receives the pending action
4. The agent downloads the new binary to a temp file next to the current executable
5. The SHA-256 checksum is verified against the expected value
6. The temp file is atomically renamed over the current executable
7. The agent re-executes itself via `syscall.Exec`, replacing the process in-place

{% hint style="info" %}
Docker agents ignore `self_update` actions. Update Docker agents by pulling a new image version instead.
{% endhint %}

### Update channels

Agents operate on one of two update channels:

| Channel | Version prefix | Description |
|---------|---------------|-------------|
| **stable** | `v1.2.3` | Production-ready releases. This is the default. |
| **dev** | `dev-abc1234` | Pre-release builds for testing. Set via `--channel dev` at first startup. |

The fleet UI displays the channel for each node. When triggering updates, VectorFlow targets the correct channel — stable agents receive the latest stable release, and dev agents receive the latest dev build. An agent's channel is determined by its version string prefix and cannot be changed without re-installing.

{% hint style="info" %}
Dev channel agents are intended for testing new agent features before rolling them out to production. They report a separate "latest version" in the fleet UI so you can track dev and stable fleets independently.
{% endhint %}

---

## Deployment mode detection

The agent automatically detects whether it is running inside a container:

- Checks for `/.dockerenv`
- Inspects `/proc/1/cgroup` for `docker`, `containerd`, or `kubepods` entries

The detected mode (`STANDALONE` or `DOCKER`) is reported in every heartbeat and displayed in the fleet UI.

---

## Data directory layout

```
/var/lib/vf-agent/              # VF_DATA_DIR
  node-token                    # Persisted node credential (0600)
  pipelines/
    <pipelineId>.yaml           # Pipeline config from server (0600)
    <pipelineId>.yaml.vf-metrics.yaml  # Auto-generated metrics sidecar
  certs/
    ca.pem                      # Certificate files (0600)
    server.crt
    server.key
```

---

## Troubleshooting

### Agent won't enroll

| Symptom | Cause | Fix |
|---------|-------|-----|
| `config error: VF_URL is required` | `VF_URL` not set | Set the `VF_URL` environment variable |
| `enrollment failed: ... connection refused` | Server unreachable | Verify `VF_URL` is correct and the server is running |
| `enrollment failed: (status 401)` | Invalid enrollment token | Generate a new enrollment token in the VectorFlow UI |
| `enrollment failed: (status 403)` | Token already used or revoked | Generate a new enrollment token |
| `no node token found at ... and VF_TOKEN is not set` | First run without `VF_TOKEN` | Set `VF_TOKEN` to the enrollment token from the UI |

### Agent shows offline

| Symptom | Cause | Fix |
|---------|-------|-----|
| Node shows "Unreachable" in fleet UI | Agent not sending heartbeats | Check agent process is running, check network connectivity to server |
| Heartbeat errors in agent logs | Network issue or server down | Check `VF_URL`, firewalls, and server health |
| Agent enrolled but no heartbeats | Node token was revoked | Re-enroll by deleting `<VF_DATA_DIR>/node-token` and restarting with a new `VF_TOKEN` |

### Pipeline won't start

| Symptom | Cause | Fix |
|---------|-------|-----|
| `start vector for pipeline ...: exec: "vector": executable file not found` | Vector binary not on PATH | Install Vector or set `VF_VECTOR_BIN` to the full path |
| Pipeline status shows CRASHED | Vector config error or runtime crash | Check the pipeline logs in the VectorFlow UI or agent stderr |
| Pipeline stuck in STARTING | Vector process started but may have issues | Check agent logs at `debug` level (`VF_LOG_LEVEL=debug`) |

### Diagnostic logging

Enable debug logging to see all HTTP requests, poll results, and pipeline actions:

```bash
VF_LOG_LEVEL=debug vf-agent
```

This logs:
- Every HTTP request and response status to the server
- Poll results including the number of pipeline actions taken
- Pipeline start/stop/restart events with PIDs
- Heartbeat payloads including pipeline and metrics data
- Certificate file writes and sample request processing
