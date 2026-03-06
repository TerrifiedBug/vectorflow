# Pipeline YAML

{% hint style="info" %}
Users typically do not write pipeline YAML directly -- the visual editor generates it. This reference is for understanding the generated output, debugging deployment issues, and advanced use cases like importing existing Vector configs.
{% endhint %}

VectorFlow pipelines are ultimately Vector configuration files. The visual pipeline editor translates your node graph into standard [Vector YAML configuration](https://vector.dev/docs/reference/configuration/) that Vector can execute directly.

---

## How YAML is generated

The pipeline YAML generation follows this flow:

```
 Visual Editor         Server                     Agent
 ┌───────────┐    ┌──────────────┐          ┌──────────────┐
 │ Drag nodes│    │ Save graph   │          │ Receive YAML │
 │ Connect   │───▶│ to database  │          │ via config   │
 │ edges     │    │              │          │ endpoint     │
 └───────────┘    │ On deploy:   │          │              │
                  │ 1. Generate  │  poll    │ Write to disk│
                  │    YAML      │────────▶ │ Start Vector │
                  │ 2. Validate  │          │ process      │
                  │ 3. Version   │          └──────────────┘
                  └──────────────┘
```

1. **Graph saved**: The visual editor saves pipeline nodes (components) and edges (connections) to the database
2. **YAML generated**: At deploy time, the server converts the graph into Vector YAML
3. **Validation**: The generated YAML is validated using `vector validate --no-environment`
4. **Versioning**: A new `PipelineVersion` record stores the YAML and a version number
5. **Distribution**: Agents poll the server and receive the YAML config for all deployed pipelines
6. **Execution**: The agent writes the YAML to disk and starts a Vector process with it

---

## YAML structure

The generated YAML follows Vector's standard configuration format with three top-level sections:

```yaml
sources:
  <component_key>:
    type: <vector_source_type>
    # ... source-specific fields

transforms:
  <component_key>:
    type: <vector_transform_type>
    inputs:
      - <upstream_component_key>
    # ... transform-specific fields

sinks:
  <component_key>:
    type: <vector_sink_type>
    inputs:
      - <upstream_component_key>
    # ... sink-specific fields
```

### Component keys

Each node in the visual editor has a **component key** -- a unique identifier within the pipeline. Component keys must:
- Start with a letter or underscore
- Contain only letters, numbers, and underscores
- Be between 1 and 128 characters

These keys become the YAML block names under `sources`, `transforms`, or `sinks`.

### Connections via `inputs`

Vector uses an `inputs` field to define data flow. When you draw an edge from node A to node B in the visual editor, the generated YAML adds A's component key to B's `inputs` array.

Sources never have `inputs` -- they are the entry points. Transforms and sinks always have at least one input.

---

## Complete example

A pipeline that receives syslog, parses and enriches the events with VRL, then sends to S3:

**Visual editor graph:**
```
[syslog_in] ──▶ [parse_logs] ──▶ [s3_output]
  (source)       (transform)        (sink)
```

**Generated YAML:**
```yaml
sources:
  syslog_in:
    type: syslog
    address: 0.0.0.0:514
    mode: udp

transforms:
  parse_logs:
    type: remap
    inputs:
      - syslog_in
    source: |
      .environment = "production"
      .processed_at = now()
      del(.source_type)

sinks:
  s3_output:
    type: aws_s3
    inputs:
      - parse_logs
    bucket: my-log-bucket
    region: us-east-1
    key_prefix: "logs/{{ .environment }}/%Y/%m/%d/"
    encoding:
      codec: json
    auth:
      access_key_id: "${SECRET_AWS_ACCESS_KEY}"
      secret_access_key: "${SECRET_AWS_SECRET_KEY}"
```

---

## Global configuration

Pipelines can include global Vector configuration sections beyond sources, transforms, and sinks. These are set via the pipeline's `globalConfig` field and appear at the top level of the generated YAML.

Common global config sections:

- **`api`**: Enable the Vector API and GraphQL playground
- **`enrichment_tables`**: Define lookup tables for enrichment

The `log_level` key in `globalConfig` is handled specially -- it is **not** included in the generated YAML. Instead, it is passed to the Vector process as the `VECTOR_LOG` environment variable.

---

## Disabled nodes

Nodes marked as **disabled** in the visual editor are excluded from the generated YAML entirely. Their edges are also removed. This lets you temporarily disable a component without deleting it from the graph.

---

## Secret references

Secrets stored in VectorFlow can be referenced in pipeline component configurations. When you use a secret in a node's config, the reference is resolved at deploy time.

### How it works

1. Create a secret in the environment's secret store (e.g., name: `AWS_ACCESS_KEY`)
2. Reference it in a component config field using the `SECRET[name]` syntax in the visual editor
3. At deploy time, the server resolves all secret references
4. The agent receives the resolved values in the config response and injects them as environment variables
5. In the generated YAML, secrets appear as `${SECRET_AWS_ACCESS_KEY}` -- standard Vector environment variable interpolation

### Example

A sink configured with secret references:

```yaml
sinks:
  elasticsearch:
    type: elasticsearch
    inputs:
      - transform_logs
    endpoints:
      - "https://es.example.com:9200"
    auth:
      strategy: basic
      user: "${SECRET_ES_USER}"
      password: "${SECRET_ES_PASSWORD}"
```

The agent injects environment variables `SECRET_ES_USER` and `SECRET_ES_PASSWORD` with the decrypted values when starting the Vector process.

---

## Certificate references

TLS certificates uploaded to VectorFlow are referenced using `CERT[name]` syntax. At deploy time:

1. Certificate data is sent to the agent in the config response (base64-encoded)
2. The agent writes cert files to `<VF_DATA_DIR>/certs/<filename>`
3. The config YAML references the local file path

### Example

```yaml
sinks:
  kafka_out:
    type: kafka
    inputs:
      - parse_logs
    bootstrap_servers: "kafka.example.com:9093"
    topic: logs
    tls:
      ca_file: "/var/lib/vf-agent/certs/ca.pem"
      crt_file: "/var/lib/vf-agent/certs/client.crt"
      key_file: "/var/lib/vf-agent/certs/client.key"
```

---

## Validation

Before any deployment, VectorFlow validates the generated YAML using the Vector binary:

```bash
vector validate --no-environment <config.yaml>
```

The `--no-environment` flag skips environment variable validation (since secrets are resolved at runtime by the agent, not at validation time).

### Validation results

The validation returns:
- **Valid**: The config is syntactically correct and all component types are recognized
- **Errors**: Specific error messages, often with the affected component key identified
- **Warnings**: Deprecation notices or non-fatal issues

If validation fails, the deployment is blocked and errors are displayed in the UI.

---

## Metrics sidecar

When the agent starts a pipeline, it automatically appends a **metrics sidecar config** as a second `--config` argument. This sidecar adds instrumentation without modifying the user's pipeline YAML:

```yaml
# Auto-generated by the VectorFlow agent
api:
  enabled: true
  address: "127.0.0.1:<dynamic-port>"

sources:
  vf_internal_metrics:
    type: internal_metrics
  vf_host_metrics:
    type: host_metrics

sinks:
  vf_metrics_exporter:
    type: prometheus_exporter
    inputs:
      - vf_internal_metrics
      - vf_host_metrics
    address: "127.0.0.1:<dynamic-port>"
```

Vector merges both config files, so the pipeline's sources/transforms/sinks coexist with the metrics instrumentation. The `vf_` prefix prevents key collisions.

---

## Version history

Every deployment creates an immutable `PipelineVersion` record containing:

| Field | Description |
|-------|-------------|
| `version` | Auto-incrementing integer (1, 2, 3, ...) |
| `configYaml` | The exact YAML that was deployed |
| `logLevel` | The Vector log level at deploy time |
| `changelog` | User-provided deploy message |
| `createdById` | Who triggered the deployment |
| `createdAt` | Deployment timestamp |

You can view previous versions in the pipeline detail page and roll back to any prior version. Rolling back creates a **new** version with the old config, preserving the full history.

---

## Importing existing configs

VectorFlow supports importing existing Vector YAML or TOML configurations into the visual editor. The importer:

1. Parses the config file
2. Creates nodes for each source, transform, and sink
3. Creates edges based on `inputs` fields
4. Auto-positions nodes in a left-to-right layout

This is useful for migrating existing Vector deployments to VectorFlow's managed model.
