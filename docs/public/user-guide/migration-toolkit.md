# Migration Toolkit

The Migration Toolkit helps you migrate existing log pipelines from other platforms to VectorFlow. Upload your existing configuration, let VectorFlow parse and translate it, then generate a ready-to-deploy pipeline.

## Supported platforms

| Platform | Status |
|----------|--------|
| **FluentD** | Supported |
| Logstash | Coming soon |
| Filebeat | Coming soon |
| Telegraf | Coming soon |

## Migration workflow

The migration process follows a five-step workflow:

{% stepper %}
{% step %}
### Create a migration project
Navigate to **Settings > Migration** and click **New Migration**. Give the project a name, select the source platform (FluentD), and paste or upload your existing configuration file.

The configuration file can be up to 500 KB in size.
{% endstep %}
{% step %}
### Parse the configuration
Click **Parse** to analyze the uploaded configuration. VectorFlow parses the config into structured blocks representing sources, filters, and outputs. Each block is identified with its plugin type and parameters.

After parsing, a **readiness report** shows how well the configuration maps to Vector components, including a readiness score (0-100%).
{% endstep %}
{% step %}
### Translate to Vector
Click **Translate** to convert the parsed blocks into Vector configuration. This step uses AI to translate each block from the source platform's format to Vector's TOML/YAML configuration.

{% hint style="info" %}
AI translation requires an AI provider to be configured for your team. Go to **Settings > AI** to set up an API key.
{% endhint %}

Each translated block includes a confidence score indicating how reliable the translation is. Low-confidence blocks may need manual review.
{% endstep %}
{% step %}
### Validate
Click **Validate** to run the generated Vector configuration through Vector's built-in validator. This catches syntax errors, invalid field names, and configuration conflicts before you deploy.

If validation fails, the error messages are displayed so you can fix the translated configuration. You can manually edit individual block configs and re-validate.
{% endstep %}
{% step %}
### Generate pipeline
Click **Generate Pipeline** to create a VectorFlow pipeline from the translated configuration. Select the target environment and give the pipeline a name. VectorFlow creates the pipeline with all nodes, edges, and configuration pre-populated from the migration.

The generated pipeline starts as a draft. Review it in the pipeline editor, make any final adjustments, then deploy when ready.
{% endstep %}
{% endstepper %}

## Built-in templates

VectorFlow includes 10 built-in migration templates that cover common FluentD patterns. When the parser detects a config that closely matches a template, the template's pre-translated Vector blocks are used instead of AI translation, resulting in higher accuracy and faster processing.

| Template | Description |
|----------|-------------|
| Tail to Elasticsearch | File tailing with Elasticsearch output |
| Tail to Kafka | File tailing with Kafka output |
| Tail to S3 | File tailing with S3 output |
| Syslog to Elasticsearch | Syslog input with Elasticsearch output |
| Forward Bridge | FluentD forward protocol bridging |
| HTTP to Datadog | HTTP input with Datadog output |
| Kubernetes to Loki | Kubernetes log collection with Loki output |
| Multi-output Fanout | Single input routing to multiple outputs |
| Log Parsing and Enrichment | Complex parsing with field enrichment |
| Grep Routing | Content-based log routing using grep filters |

## AI translation

For configurations that do not match a built-in template, VectorFlow uses AI to translate each block. The AI translator:

- Receives the parsed block structure along with the source platform context
- Generates the equivalent Vector component configuration
- Assigns a confidence score based on the complexity and clarity of the mapping
- Flags any warnings about features that may not have a direct Vector equivalent

You can re-translate individual blocks if the initial result is not satisfactory. Click the **Re-translate** button next to any block to trigger a fresh AI translation for that specific block.

### Manual block editing

After translation, you can manually edit any block's configuration. Click a block in the translation results to open its config editor. Changes are saved to the migration project and reflected when you regenerate the Vector YAML.

## Readiness score

The readiness score (0-100%) is computed during the parse step and indicates how smoothly the migration is likely to go. It is based on:

- **Plugin coverage** -- What percentage of the source config's plugins have known Vector equivalents
- **Configuration complexity** -- How many advanced or non-standard features are used
- **Template match** -- Whether the config matches a built-in template

A score above 80% generally indicates a straightforward migration. Scores below 50% suggest significant manual work may be needed.

The readiness report also includes a **plugin inventory** listing every plugin found in the source config and its mapping status (mapped, partially mapped, or unmapped).

## Project management

Migration projects are scoped to a team. From the migration list page you can:

- View all migration projects with their status, readiness score, and creation date
- Open a project to continue the workflow from where you left off
- Delete a project you no longer need

Project statuses track the workflow progress:

| Status | Description |
|--------|-------------|
| **Draft** | Project created, configuration uploaded |
| **Parsing** | Configuration is being parsed |
| **Translating** | Blocks are being translated via AI |
| **Validating** | Generated config is being validated |
| **Ready** | Translation complete, ready to generate pipeline |
| **Generating** | Pipeline is being created |
| **Completed** | Pipeline generated successfully |
| **Failed** | An error occurred (see error message for details) |

---

## Vector Config Import

The Vector Config Import tool lets you quickly import existing Vector YAML or TOML configurations directly into VectorFlow pipelines. Unlike the Migration Toolkit (which translates from other platforms like FluentD), this tool works with Vector configs you already have—whether exported from another Vector instance, version-controlled, or generated by a script.

### Supported formats

- **YAML** (.yaml, .yml)
- **TOML** (.toml)

### What happens during import

When you import a Vector config, VectorFlow:

1. Parses the configuration file into its component structure (sources, transforms, sinks)
2. **Automatically detects independent data paths** — each logical pipeline is identified and can be split into separate VectorFlow pipelines if needed
3. Extracts global configuration (api, enrichment_tables, etc.) that applies across all pipelines
4. Creates nodes, edges, and layout automatically using intelligent graph positioning
5. Normalizes deprecated field names and auth headers for compatibility

### Quick start: Import in the editor

The fastest way to import is via the pipeline editor:

1. Open the pipeline editor
2. Press **Cmd+I** (or Ctrl+I on Windows/Linux) to open the import dialog
3. Select your Vector config file (YAML or TOML)
4. Review the imported nodes and connections
5. Save and deploy

The imported config is merged into the current pipeline. All nodes and edges are positioned automatically.

{% hint style="info" %}
This method imports into a single pipeline. If your config contains multiple independent pipelines, use the REST API to import each separately with different names.
{% endhint %}

### Advanced: Import via REST API

For bulk imports or integration with external tools, use the REST API:

```bash
curl -X POST https://your-vectorflow-instance/api/v1/pipelines/import \
  -H "Authorization: Bearer vf_<api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "imported-pipeline",
    "description": "Imported from production Vector config",
    "yaml": "<your Vector YAML config here>"
  }'
```

Response includes the created pipeline ID and node/edge count:

```json
{
  "pipeline": {
    "id": "pipeline_123",
    "name": "imported-pipeline",
    "nodeCount": 5,
    "edgeCount": 4
  }
}
```

{% hint style="warning" %}
The API requires the `pipelines.write` permission. Use a service account with appropriate scopes.
{% endhint %}

### Subgraph detection

When your Vector config contains multiple independent data paths, VectorFlow detects them automatically. For example, a config with:

- Source A → Transform 1 → Sink A
- Source B → Transform 2 → Sink B

...can be split into two separate pipelines. During import, you can:

- Import all into one pipeline (fully connected via shared transforms)
- Rename and select which subgraphs to include
- Import each subgraph separately using the REST API with appropriate filtering

### Global configuration

Vector global settings like `api`, `enrichment_tables`, and `log` schemas are extracted during import and stored as pipeline-wide configuration. These settings apply to all components in the imported pipeline.

You can edit global config from the **Pipeline Settings** panel in the editor.

### Known limitations and tips

- **Field normalization**: Deprecated field names (e.g., `fingerprinting` → `fingerprint`) are automatically updated for compatibility
- **Auth headers**: Request Authorization headers are converted to Vector's canonical `auth` structure with strategy and token/credentials
- **Type fallback**: If a component type is not found in VectorFlow's catalog, it's added as an unresolved type—you can manually edit its config but validation may be limited
- **Empty sections**: Sources/transforms/sinks sections that are empty are skipped
- **Comments and formatting**: YAML/TOML comments and formatting are not preserved (configs are reparsed and normalized)
