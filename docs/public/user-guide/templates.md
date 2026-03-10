# Templates

Templates are reusable pipeline blueprints that capture a complete pipeline graph -- sources, transforms, sinks, their configurations, and how they connect. Save common patterns as templates so your team can spin up new pipelines in seconds without rebuilding from scratch.

## Template library

Templates are found in the **Library** page (accessible from the sidebar), under the **Templates** tab. The page displays all templates available to your team as a card grid. Each card shows:

- **Name** -- The template name.
- **Category** -- A label such as Logging, Metrics, Archival, Streaming, or a custom category you define.
- **Description** -- A short summary of what the template does.
- **Node and edge count** -- How many pipeline components and connections the template contains.

{% hint style="info" %}
Templates are shared across all environments within a team. Any team member with the Editor role or above can create and use templates.
{% endhint %}

## Saving a pipeline as a template

You can save any pipeline from the pipeline editor as a reusable template.

{% stepper %}
{% step %}
### Open a pipeline
Navigate to the pipeline editor for the pipeline you want to save as a template.
{% endstep %}
{% step %}
### Click Save as Template
In the editor toolbar, click the **Save as Template** button. A dialog opens.
{% endstep %}
{% step %}
### Fill in the details
- **Name** -- A descriptive name (e.g., "Kafka to Elasticsearch").
- **Description** -- Explain what the template does and when to use it.
- **Category** -- Choose an existing category or type a custom one (e.g., "Logging", "Metrics", "Security").
{% endstep %}
{% step %}
### Save
Click **Save Template**. The template now appears in the template library for all team members.
{% endstep %}
{% endstepper %}

## Creating a pipeline from a template

{% stepper %}
{% step %}
### Open the Library
Navigate to **Library > Templates** in the sidebar. Make sure you have an environment selected in the header.
{% endstep %}
{% step %}
### Choose a template
Browse the template cards and click **Use Template** on the one you want.
{% endstep %}
{% step %}
### Customize
VectorFlow creates a new pipeline in the current environment with the template's graph pre-loaded. The pipeline opens in the editor where you can rename it, adjust configurations, and wire in environment-specific settings like secrets.
{% endstep %}
{% endstepper %}

## What templates include

Templates save the complete pipeline graph:

- **Nodes** -- Every source, transform, and sink component, including its component type, component key, display name, and configuration.
- **Edges** -- All connections between components, preserving the data flow topology.
- **Layout** -- The X/Y positions of nodes on the canvas, so the visual layout is preserved.

## What templates do not include

Templates are designed to be portable across environments, so they intentionally exclude:

- **Secrets** -- Secret values (API keys, passwords, tokens) are never stored in templates. You must configure secrets in the target environment after creating a pipeline from a template.
- **Certificates** -- TLS certificates are environment-specific and are not included.
- **Environment bindings** -- Templates are not tied to any specific environment. They can be used in any environment within the team.
- **Shared component links** -- Nodes that are linked to [shared components](shared-components.md) have their links stripped when saved as a template. The node's configuration snapshot is preserved, but the template node becomes a standalone component.
- **Deployment state** -- Pipelines created from templates start as drafts. You deploy them when ready.

{% hint style="warning" %}
After creating a pipeline from a template, review the configuration and add any required secrets or environment-specific values before deploying.
{% endhint %}

## Managing templates

- **Delete** -- Click the trash icon on a template card to permanently remove it. This does not affect pipelines that were already created from the template.
- Templates cannot be edited after creation. To update a template, save the revised pipeline as a new template and delete the old one.

## Template categories

Templates are organized by category. Built-in categories include:

| Category | Description |
|----------|-------------|
| **Getting Started** | Simple example pipelines for learning VectorFlow. |
| **Logging** | Log collection, parsing, and routing patterns. |
| **Archival** | Long-term storage and compliance pipelines. |
| **Streaming** | Real-time event streaming configurations. |
| **Metrics** | Metric collection and aggregation patterns. |

You can also create custom categories by typing any name in the Category field when saving a template.
