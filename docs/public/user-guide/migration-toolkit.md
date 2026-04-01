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
