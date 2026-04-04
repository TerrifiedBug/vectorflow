# VectorFlow Metrics Reference

VectorFlow exposes a Prometheus-compatible metrics endpoint at `GET /api/metrics`.

## Authentication

The endpoint requires a service account Bearer token with the `metrics.read` permission:

```
Authorization: Bearer vf_<your-service-account-key>
```

Generate a service account key in **Settings → Service Accounts**.

---

## Prometheus Scrape Configuration

Add this job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: vectorflow
    scrape_interval: 30s
    scrape_timeout: 10s
    scheme: https                      # use http for local dev
    metrics_path: /api/metrics
    authorization:
      credentials: vf_<your-key>       # or use credentials_file
    static_configs:
      - targets:
          - your-vectorflow-host:443
        labels:
          env: production
```

For Docker Compose environments, replace the target with the service name and port (e.g. `vectorflow:3000`).

---

## Metrics

All VectorFlow metric names are prefixed with `vectorflow_`. Metrics are exposed in **Prometheus text format 0.0.4**.

> **Implementation note:** Throughput counters (`events_in_total`, `events_out_total`, etc.) are registered as Gauge types in prom-client but store cumulative totals sourced from the database. They are monotonically increasing across the lifetime of a pipeline run and behave correctly with `rate()` and `increase()` in PromQL.

---

### Node Metrics

#### `vectorflow_node_status`

Node health status.

| Field | Value |
|-------|-------|
| **Type** | Gauge |
| **Labels** | `node_id`, `node_name`, `environment_id` |

**Value mapping:**

| Value | Status | Meaning |
|-------|--------|---------|
| `1` | `HEALTHY` | Node is reachable and operating normally |
| `2` | `DEGRADED` | Node is reachable but reporting issues |
| `3` | `UNREACHABLE` | Node cannot be contacted |
| `0` | `UNKNOWN` | Status has not been determined yet |

**Example queries:**

```promql
# All unhealthy nodes
vectorflow_node_status != 1

# Fraction of healthy nodes
(count(vectorflow_node_status == 1) or vector(0)) / count(vectorflow_node_status)

# Alert: any node unreachable for >2 min
vectorflow_node_status == 3
```

---

### Pipeline Metrics

All pipeline metrics carry the labels `node_id` and `pipeline_id`.

#### `vectorflow_pipeline_status`

Pipeline process status.

| Field | Value |
|-------|-------|
| **Type** | Gauge |
| **Labels** | `node_id`, `pipeline_id` |

**Value mapping:**

| Value | Status | Meaning |
|-------|--------|---------|
| `1` | `RUNNING` | Pipeline is actively processing events |
| `2` | `STARTING` | Pipeline process is initialising |
| `3` | `STOPPED` | Pipeline was stopped gracefully |
| `4` | `CRASHED` | Pipeline process exited unexpectedly |
| `0` | `PENDING` | Pipeline has not started yet |

---

#### `vectorflow_pipeline_events_in_total`

Cumulative count of events received by the pipeline since it started.

| Field | Value |
|-------|-------|
| **Type** | Gauge (cumulative total) |
| **Unit** | Events |
| **Labels** | `node_id`, `pipeline_id` |

**Example queries:**

```promql
# Current ingest rate (events/sec)
rate(vectorflow_pipeline_events_in_total[2m])

# Total events ingested across all pipelines
sum(vectorflow_pipeline_events_in_total)
```

---

#### `vectorflow_pipeline_events_out_total`

Cumulative count of events emitted by the pipeline since it started.

| Field | Value |
|-------|-------|
| **Type** | Gauge (cumulative total) |
| **Unit** | Events |
| **Labels** | `node_id`, `pipeline_id` |

**Example queries:**

```promql
# Outbound throughput rate
rate(vectorflow_pipeline_events_out_total[2m])

# Drop rate: events consumed but not forwarded
rate(vectorflow_pipeline_events_in_total[2m])
  - rate(vectorflow_pipeline_events_out_total[2m])
```

---

#### `vectorflow_pipeline_errors_total`

Cumulative count of errors encountered by the pipeline.

| Field | Value |
|-------|-------|
| **Type** | Gauge (cumulative total) |
| **Unit** | Errors |
| **Labels** | `node_id`, `pipeline_id` |

**Example queries:**

```promql
# Error rate
rate(vectorflow_pipeline_errors_total[2m])

# Error ratio (errors per inbound event)
rate(vectorflow_pipeline_errors_total[5m])
  / (rate(vectorflow_pipeline_events_in_total[5m]) > 0)
```

---

#### `vectorflow_pipeline_events_discarded_total`

Cumulative count of events intentionally discarded (e.g. by a `filter` or `drop` transform).

| Field | Value |
|-------|-------|
| **Type** | Gauge (cumulative total) |
| **Unit** | Events |
| **Labels** | `node_id`, `pipeline_id` |

---

#### `vectorflow_pipeline_bytes_in_total`

Cumulative byte volume received by the pipeline since it started.

| Field | Value |
|-------|-------|
| **Type** | Gauge (cumulative total) |
| **Unit** | Bytes |
| **Labels** | `node_id`, `pipeline_id` |

**Example queries:**

```promql
# Inbound throughput in bytes/sec
rate(vectorflow_pipeline_bytes_in_total[2m])
```

---

#### `vectorflow_pipeline_bytes_out_total`

Cumulative byte volume emitted by the pipeline since it started.

| Field | Value |
|-------|-------|
| **Type** | Gauge (cumulative total) |
| **Unit** | Bytes |
| **Labels** | `node_id`, `pipeline_id` |

---

#### `vectorflow_pipeline_utilization`

Fractional CPU/processing utilisation of the pipeline, as reported by the Vector process. Range: `0.0` (idle) to `1.0` (fully saturated).

| Field | Value |
|-------|-------|
| **Type** | Gauge |
| **Unit** | Ratio (0–1) |
| **Labels** | `node_id`, `pipeline_id` |

**Example queries:**

```promql
# Pipelines over 80% utilisation
vectorflow_pipeline_utilization > 0.8

# Average utilisation across all running pipelines
avg(vectorflow_pipeline_utilization > 0)
```

---

#### `vectorflow_pipeline_latency_mean_ms`

Mean end-to-end pipeline latency in milliseconds, sourced from the latest `PipelineMetric` snapshot stored in the database. This metric only appears when latency data has been reported.

| Field | Value |
|-------|-------|
| **Type** | Gauge |
| **Unit** | Milliseconds |
| **Labels** | `pipeline_id`, `node_id` |

**Example queries:**

```promql
# Pipelines with mean latency > 1 second
vectorflow_pipeline_latency_mean_ms > 1000

# 95th percentile latency across pipelines (approximate via max)
max(vectorflow_pipeline_latency_mean_ms)
```

---

### Internal Metrics

#### `vectorflow_metric_store_streams`

Number of active metric streams held in the in-process `MetricStore`. Each stream corresponds to a live metric time series being accumulated in memory before persistence.

| Field | Value |
|-------|-------|
| **Type** | Gauge |
| **Unit** | Count |
| **Labels** | None |

---

#### `vectorflow_metric_store_memory_bytes`

Estimated memory consumed by the in-process `MetricStore`, in bytes.

| Field | Value |
|-------|-------|
| **Type** | Gauge |
| **Unit** | Bytes |
| **Labels** | None |

**Example queries:**

```promql
# Alert if MetricStore exceeds 100 MiB
vectorflow_metric_store_memory_bytes > 104857600
```

---

## Summary Table

| Metric | Type | Labels | Unit |
|--------|------|--------|------|
| `vectorflow_node_status` | Gauge | `node_id`, `node_name`, `environment_id` | Enum (0–3) |
| `vectorflow_pipeline_status` | Gauge | `node_id`, `pipeline_id` | Enum (0–4) |
| `vectorflow_pipeline_events_in_total` | Gauge (cumulative) | `node_id`, `pipeline_id` | Events |
| `vectorflow_pipeline_events_out_total` | Gauge (cumulative) | `node_id`, `pipeline_id` | Events |
| `vectorflow_pipeline_errors_total` | Gauge (cumulative) | `node_id`, `pipeline_id` | Errors |
| `vectorflow_pipeline_events_discarded_total` | Gauge (cumulative) | `node_id`, `pipeline_id` | Events |
| `vectorflow_pipeline_bytes_in_total` | Gauge (cumulative) | `node_id`, `pipeline_id` | Bytes |
| `vectorflow_pipeline_bytes_out_total` | Gauge (cumulative) | `node_id`, `pipeline_id` | Bytes |
| `vectorflow_pipeline_utilization` | Gauge | `node_id`, `pipeline_id` | Ratio (0–1) |
| `vectorflow_pipeline_latency_mean_ms` | Gauge | `pipeline_id`, `node_id` | Milliseconds |
| `vectorflow_metric_store_streams` | Gauge | — | Count |
| `vectorflow_metric_store_memory_bytes` | Gauge | — | Bytes |

---

## Pre-built Dashboards and Rules

| File | Description |
|------|-------------|
| `monitoring/grafana/vectorflow-overview.json` | Grafana 10+ dashboard — import via **Dashboards → Import** |
| `monitoring/prometheus/vectorflow.rules.yml` | Recording rules and alerting rules — reference from `prometheus.yml` |

### Loading the Grafana dashboard

1. Open Grafana → **Dashboards → Import**.
2. Upload `monitoring/grafana/vectorflow-overview.json` or paste its contents.
3. Select your Prometheus data source when prompted.
4. Click **Import**.

### Loading the Prometheus rules

Add a reference in `prometheus.yml`:

```yaml
rule_files:
  - /etc/prometheus/rules/vectorflow.rules.yml
```

Then copy `monitoring/prometheus/vectorflow.rules.yml` to that path and reload Prometheus:

```bash
curl -X POST http://localhost:9090/-/reload
```

Verify rules loaded successfully:

```bash
curl http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name | startswith("vectorflow"))'
```
