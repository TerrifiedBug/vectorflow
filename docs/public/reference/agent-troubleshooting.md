# Agent Troubleshooting

This guide covers the most common operational issues with `vf-agent`. For a reference of all configuration options, see [Agent Reference](./agent.md). For an explanation of how the agent works internally, see [Agent Architecture](./agent-architecture.md).

---

## 1. Agent not enrolling

The agent enrolls once on first startup. If enrollment fails, it exits immediately with a non-zero status.

### Diagnosis checklist

```bash
# Check the error message
journalctl -u vf-agent -n 50 --no-pager

# Or if running manually:
vf-agent 2>&1 | head -20
```

### Common causes

| Error message | Cause | Fix |
|---------------|-------|-----|
| `config error: VF_URL is required` | `VF_URL` env var not set | Set `VF_URL` to your server URL (e.g., `https://vectorflow.example.com`) |
| `enrollment failed: ... connection refused` | Server unreachable | Verify the server is running and `VF_URL` is correct including the scheme (`https://`) |
| `enrollment failed: (status 401)` | Invalid or expired enrollment token | Generate a new token in VectorFlow → Settings → Tokens |
| `enrollment failed: (status 403)` | Token already used or maximum node count reached | Generate a new token or check your node limit |
| `no node token found and VF_TOKEN is not set` | Re-enrollment needed but token not provided | Delete `<VF_DATA_DIR>/node-token` and restart with `VF_TOKEN` set, **or** re-set `VF_TOKEN` and restart |
| `enrollment failed: ... certificate verify failed` | TLS certificate issue | Check that your server's TLS certificate is valid; use `curl -v $VF_URL` to diagnose |

### Network connectivity test

```bash
# Verify the agent can reach the server
curl -v "$VF_URL/api/health"

# If using a proxy, ensure HTTP_PROXY / HTTPS_PROXY is set correctly
```

### Re-enrollment

To force re-enrollment (for example, after replacing a node):

```bash
rm /var/lib/vf-agent/node-token
VF_TOKEN=vf_enroll_newtoken... vf-agent
```

---

## 2. Pipeline stuck in STARTING

After a pipeline is deployed, it shows **STARTING** in the fleet UI and never transitions to **RUNNING**.

### How STARTING works

The supervisor marks a pipeline RUNNING 2 seconds after the Vector process starts (a fixed startup grace period). If the process crashes within those 2 seconds, the status remains STARTING until the crash recovery goroutine restarts it.

### Diagnosis

```bash
# Enable debug logging to see Vector startup details
VF_LOG_LEVEL=debug vf-agent

# Check if Vector is actually running
ps aux | grep vector

# Check agent stderr for crash messages
journalctl -u vf-agent -n 100 --no-pager | grep -E "CRASH|error|failed"
```

### Common causes

| Symptom in logs | Cause | Fix |
|-----------------|-------|-----|
| `exec: "vector": executable file not found` | Vector not installed or not on PATH | Install Vector or set `VF_VECTOR_BIN=/path/to/vector` |
| Vector process exits immediately with config errors | Pipeline YAML is invalid | Check pipeline config in VectorFlow editor; look at Vector log output for `Configuration error:` |
| `address already in use` | Port conflict on 8688+ | Check if another Vector process or service is using ports starting at 8688; restart agent to get new port assignments |
| `failed to write sidecar config` | `VF_DATA_DIR` permissions | Ensure agent has write access to `VF_DATA_DIR/pipelines/` |
| Pipeline starts then keeps crashing (CRASHED) | Runtime error in pipeline (e.g., source unreachable) | View pipeline logs in the VectorFlow UI or agent stdout/stderr |

### Port conflict resolution

The agent allocates ports sequentially starting at 8688. If another process is using those ports:

```bash
# Check what's using ports in the 8688+ range
ss -tlnp | grep 868
lsof -i :8688-8750
```

Restart the agent to get new port assignments from the next available sequence position.

### Crash recovery backoff

If a pipeline crashes repeatedly, the agent enters exponential backoff (1s → 2s → 4s → ... → 60s cap). A pipeline stuck in repeated crash/restart cycles will show alternating CRASHED/STARTING in the UI. To force a clean restart, stop and redeploy the pipeline from the VectorFlow UI.

---

## 3. Metrics not appearing

Pipeline metrics (events in/out, bytes, errors) show as zeros or are absent in the fleet dashboard.

### Architecture context

The agent scrapes Vector's Prometheus endpoint on `127.0.0.1:<metricsPort>` during each heartbeat. If this scrape fails or returns no data, heartbeats will contain zero metrics.

### Diagnosis

```bash
# Find the metrics port for a running pipeline (look in agent debug logs)
VF_LOG_LEVEL=debug vf-agent 2>&1 | grep "metrics"

# Try scraping manually (first pipeline uses port 8688)
curl -s http://127.0.0.1:8688/metrics | head -30

# Check if Vector is listening on that port
ss -tlnp | grep 8688
```

### Common causes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Curl returns connection refused | Sidecar config write failed, or Vector API not started | Check `VF_DATA_DIR/pipelines/` for `.vf-metrics.yaml` files; check permissions |
| Curl returns data but dashboard shows zeros | Metrics haven't accumulated yet | Wait for the first poll cycle; Vector metrics start at 0 and only appear after events flow through |
| Host metrics missing but pipeline metrics present | `host_metrics` source failing | Check that the agent has access to `/proc`, `/sys`, `/dev/disk` (common in restricted containers) |
| Sidecar config exists but Vector rejects it | Component ID collision (`vf_internal_metrics` already defined) | Rename conflicting components in your pipeline config |
| Agent shows no metrics port | Pipeline in STARTING/CRASHED state | Metrics are only scraped for RUNNING pipelines |

### Agent self-metrics not appearing

If the agent's own metrics endpoint (`VF_METRICS_PORT`, default 9090) is not reachable:

```bash
# Check if the agent is listening on 9090
curl http://127.0.0.1:9090/metrics

# Disable with VF_METRICS_PORT=0 if port conflicts exist
```

---

## 4. High memory usage

The agent or its Vector child processes are consuming unexpectedly high memory.

### Agent memory

The agent itself is lightweight (typically 10–30 MB RSS). If it's growing:

- **Log buffer growth**: Each pipeline gets a 500-line ring buffer (`internal/logbuf`). This is bounded and won't grow unboundedly. If many pipelines are running, the total buffer is `500 lines × N pipelines`.
- **Sample results**: If the server is sending many sample requests and the agent can't deliver results fast enough, `sampleResults` can accumulate. This is bounded by rate of sampling goroutines completing.
- **Memory leak**: If agent memory grows without bound, enable debug logging to check for unusual activity and file an issue.

```bash
# Monitor agent memory over time
while true; do ps -o pid,rss,vsz,comm -p $(pgrep vf-agent); sleep 5; done
```

### Vector process memory

High memory in Vector child processes is almost always caused by pipeline configuration:

| Cause | Symptom | Fix |
|-------|---------|-----|
| Buffered events (slow sink) | Memory grows over time | Check sink health; add backpressure or drop policies |
| `global.data_dir` defaults | Vector writes to disk buffer | Set `data_dir` explicitly to a volume with sufficient space |
| Many concurrent pipelines | Linear memory growth with pipeline count | Each Vector process is independent; reduce active pipelines or use larger nodes |
| `host_metrics` scraping everything | High baseline memory | Restrict `host_metrics` collectors in the sidecar if not needed |

```bash
# Check memory per Vector process
ps aux --sort=-%mem | grep vector
```

---

## 5. Push connection drops

The SSE push connection drops frequently, causing delayed config updates.

### Understanding push reconnection

The push client maintains a persistent SSE connection to the server. On any drop, it reconnects with exponential backoff (1s → 30s max). Each reconnection increments `vf_agent_push_reconnects_total` and is logged at WARN level.

Push drops are non-critical — the polling fallback ensures config updates still arrive within one poll interval.

### Diagnosis

```bash
# Watch for push reconnection warnings in real time
journalctl -u vf-agent -f | grep "push:"

# Check the self-metrics endpoint for reconnect count
curl http://127.0.0.1:9090/metrics | grep reconnect
# vf_agent_push_reconnects_total 42

# Check push connected status
curl http://127.0.0.1:9090/metrics | grep connected
# vf_agent_push_connected 1
```

### Common causes

| Cause | Symptom | Fix |
|-------|---------|-----|
| Reverse proxy timeout | Connection drops every N minutes | Increase proxy idle/read timeout; set `proxy_read_timeout 3600` in nginx or equivalent |
| Load balancer session affinity | Connection works then switches servers | Enable sticky sessions (same-server routing) for the push endpoint |
| TLS handshake failures | Rapid reconnect loop with TLS errors | Check certificate validity and that the agent trusts the server CA |
| Network interruptions | Sporadic drops correlated with network issues | Normal; push reconnects automatically — monitor `vf_agent_push_reconnects_total` |
| Large push payload | Scanner buffer overflow (>256KB) | Reduce sample payload size; this is typically a server-side configuration issue |

### Proxy configuration examples

**nginx:**
```nginx
location /api/agent/push {
    proxy_pass http://vectorflow:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';  # disable keep-alive timeout
    proxy_read_timeout 3600s;
    proxy_buffering off;
    chunked_transfer_encoding on;
}
```

**Caddy:**
```caddy
reverse_proxy /api/agent/push vectorflow:3000 {
    flush_interval -1  # immediate flush (required for SSE)
    transport http {
        read_timeout 0  # no timeout
    }
}
```

**Traefik:** Set `ReadTimeout` on the backend service, or use a `Middleware` with `InFlightReq` to avoid idle connection limits.

---

## General diagnostics

### Enable debug logging

Debug logging shows every HTTP request, poll result, and pipeline event:

```bash
VF_LOG_LEVEL=debug vf-agent
```

Key things to look for:
- `http request` / `http response` lines show the server communication
- `poll complete` shows how many pipeline actions were taken
- `heartbeat sent` confirms successful delivery
- `push: connected` / `push: connection lost` shows SSE state

### Check agent self-metrics

The `/metrics` endpoint exposes counters that summarize agent health over its lifetime:

```bash
curl -s http://127.0.0.1:9090/metrics
```

Key counters:
- `vf_agent_poll_errors_total`: Non-zero means the agent can't reach the server
- `vf_agent_push_reconnects_total`: High value means frequent push drops
- `vf_agent_heartbeat_errors_total`: Non-zero means heartbeats failing (usually same root cause as poll errors)
- `vf_agent_pipelines_running`: Should match the number of deployed pipelines on this node

### Fleet UI status mapping

| Fleet UI status | Agent status string | Meaning |
|-----------------|---------------------|---------|
| Running | `RUNNING` | Vector process is live and healthy |
| Starting | `STARTING` | Vector process started; 2s startup grace period |
| Stopped | `STOPPED` | Pipeline cleanly stopped (undeploy) |
| Crashed | `CRASHED` | Vector process exited unexpectedly; restart pending |
| Unreachable | *(no heartbeat)* | Agent is not sending heartbeats; agent likely down |

### Collect a support bundle

When filing a bug report or support request, include:

```bash
# Agent version
vf-agent --version

# Agent logs (last 200 lines)
journalctl -u vf-agent -n 200 --no-pager

# Self-metrics snapshot
curl -s http://127.0.0.1:9090/metrics

# System info
uname -a
vector --version
free -h
df -h /var/lib/vf-agent
```
