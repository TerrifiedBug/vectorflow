# AI Suggestions

VectorFlow includes optional AI-powered assistance for writing VRL code and generating pipeline configurations. When enabled, team members with Editor or Admin roles can use AI features in both the VRL editor and pipeline builder.

## Setup

Team admins can configure AI in **Settings → AI**. The configuration requires:

| Field | Description |
|-------|-------------|
| **Provider** | OpenAI, Anthropic, or Custom (any OpenAI-compatible endpoint) |
| **Base URL** | API endpoint — pre-filled for known providers |
| **API Key** | Provider API key — encrypted at rest using AES-256 |
| **Model** | Model identifier (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |

After saving, use **Test Connection** to verify the configuration works.

{% hint style="info" %}
VectorFlow uses the OpenAI-compatible chat completions API format (`/chat/completions`). Most providers support this format natively or via a compatibility layer. For Anthropic, use an OpenAI-compatible proxy such as LiteLLM or OpenRouter.
{% endhint %}

## VRL Assistant

In the VRL editor (opened from any remap, filter, or route transform), click the **AI** button in the tools panel to reveal the AI input.

1. Type a natural language description of what you want the VRL code to do
2. Click **Generate** — the AI streams VRL code in real time
3. When complete, choose:
   - **Insert** — append the generated code after your existing code
   - **Replace** — replace all existing code with the generated result
   - **Regenerate** — try again with the same prompt

The AI is aware of your upstream source types and available fields, so you can reference them naturally (e.g., "parse the syslog message and extract the hostname").

## Pipeline Builder

In the pipeline editor toolbar, click the **sparkle icon** to open the AI Pipeline Builder dialog.

### Generate mode

Describe a pipeline in plain language:

> "Collect Kubernetes logs from a file source, drop debug-level events, parse JSON, and send to Elasticsearch and S3"

The AI generates a complete Vector YAML configuration. Click **Apply to Canvas** to add the generated components to your pipeline. If your canvas already has components, the new ones are positioned below the existing layout to avoid overlap.

### Review mode

Ask the AI to analyze your current pipeline configuration:

> "Are there any performance issues with my pipeline?"

The AI reviews the generated YAML and provides suggestions for improvements, best practices, and potential issues.

## Rate Limits

AI requests are rate-limited to 60 requests per hour per team to prevent excessive API usage. The limit resets on a rolling window.

## Security

- API keys are encrypted at rest using AES-256-GCM
- Keys are never exposed to the client — the settings page shows only whether a key is saved
- AI configuration changes are recorded in the audit log with the API key redacted
- Only team members with Editor or Admin roles can use AI features
