# VRL Snippets

## What is VRL?

**VRL (Vector Remap Language)** is a purpose-built expression language for transforming observability data. It is the primary way to reshape, filter, and enrich events inside Vector pipelines. VRL is used in `remap`, `filter`, and `route` transforms.

{% hint style="info" %}
VRL compiles to native Rust and runs inside the Vector process, so transforms execute with minimal overhead -- typically microseconds per event. For the full language reference, see the [official VRL documentation](https://vector.dev/docs/reference/vrl/).
{% endhint %}

## Snippet library

VectorFlow ships with a built-in library of reusable VRL snippets that cover common transformation patterns. You can also create your own **custom snippets** that are shared with your team.

Snippets are accessible from the VRL editor inside the pipeline editor. When you are editing a `remap`, `filter`, or `route` transform, a snippet drawer is available that lets you search, browse, and insert snippets directly into your code.

### Built-in categories

The built-in snippet library is organized into the following categories:

| Category | Examples |
|----------|---------|
| **Parsing** | `parse_json`, `parse_syslog`, `parse_csv`, `parse_key_value`, `parse_regex`, `parse_grok`, `parse_apache_log`, `parse_nginx_log` |
| **Filtering** | `del(.field)`, keep fields, `if/else` conditions, `abort` (drop event), `assert`, `compact` |
| **Enrichment** | Set fields, rename fields, merge objects, add tags, set timestamp, `uuid_v4()` |
| **Type Coercion** | `to_int`, `to_float`, `to_bool`, `to_string`, `to_timestamp` |
| **Encoding** | `encode_json`, `encode_logfmt`, `encode_base64`, `decode_base64` |
| **String** | `downcase`, `upcase`, `strip_whitespace`, `replace`, `contains`, `starts_with`, `split`, `join` |
| **Timestamp** | `now()`, `format_timestamp`, `parse_timestamp`, `to_unix_timestamp` |
| **Networking** | `ip_cidr_contains`, `parse_url`, `ip_to_ipv6`, `community_id` |

### Inserting a snippet

{% stepper %}
{% step %}
### Open the snippet drawer
In the VRL editor, click the **snippets** toggle to open the snippet drawer below the code editor.
{% endstep %}
{% step %}
### Browse or search
Scroll through the categories or type in the search box to filter snippets by name, description, or code content.
{% endstep %}
{% step %}
### Click to insert
Click any snippet to insert its VRL code at the current cursor position in the editor. Adjust placeholder values (like field names) to match your data.
{% endstep %}
{% endstepper %}

## Creating custom snippets

Your team can create custom snippets that appear alongside the built-in library, tagged with a **Custom** badge.

{% stepper %}
{% step %}
### Open the snippet form
Click the **+** button in the snippet drawer header to open the creation form.
{% endstep %}
{% step %}
### Fill in the details
- **Name** -- A short, descriptive name (required, up to 100 characters).
- **Description** -- An optional explanation of what the snippet does (up to 500 characters).
- **Category** -- Choose from the built-in categories or select "Custom".
- **Code** -- The VRL code to insert (required).
{% endstep %}
{% step %}
### Save
Click **Create** to save the snippet. It will immediately appear in the drawer for all team members.
{% endstep %}
{% endstepper %}

Custom snippets can be **edited** or **deleted** by hovering over them in the drawer and clicking the pencil or trash icon. Only team members with Editor access or higher can create, edit, or delete custom snippets.

## Testing VRL

The VRL editor includes a built-in **test runner** that lets you execute your VRL code against sample data without deploying the pipeline.

{% stepper %}
{% step %}
### Write your VRL code
Enter your transform logic in the VRL editor.
{% endstep %}
{% step %}
### Provide a sample event
Enter a JSON object in the **input** panel. If you leave it blank, a default test event is used:
```json
{
  "message": "test event",
  "timestamp": "2026-01-01T00:00:00Z",
  "host": "localhost"
}
```
{% endstep %}
{% step %}
### Run the test
Click the **Run** button. VectorFlow executes your VRL program against the input using the `vector vrl` CLI and displays the transformed output or any error messages.
{% endstep %}
{% endstepper %}

{% hint style="warning" %}
VRL testing requires the `vector` binary to be installed on the VectorFlow server. If it is not available, the test runner will show an error with installation instructions.
{% endhint %}

### Live event sampling

For deployed pipelines, you can also sample **live events** flowing through upstream sources and use them as test input. The VRL editor provides:

- A **Sample** button that requests recent events from the running pipeline
- Navigation controls to step through multiple sampled events
- A **Fields** panel that shows the inferred schema of upstream source events, so you know which fields are available for transformation

## Example snippets

Here are a few commonly used VRL patterns:

### Parse syslog messages

```coffee
. = merge!(., parse_syslog!(.message))
```

Parses a syslog-formatted `.message` field and merges the structured fields (timestamp, hostname, severity, etc.) into the top-level event.

### Extract and rename fields

```coffee
.host = del(.hostname)
.severity = del(.level)
.service = "my-app"
```

Renames fields by moving values to new keys and sets a static field.

### Redact sensitive data

```coffee
.message = redact(.message, filters: [r'\d{3}-\d{2}-\d{4}', r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'])
```

Replaces patterns matching US Social Security numbers and email addresses with `[REDACTED]`.

### Drop debug-level events

```coffee
if .level == "debug" {
  abort
}
```

Used in a `remap` transform with `drop_on_abort` enabled, this drops all events where the level is "debug", reducing volume before data reaches your sinks.

### Conditional enrichment

```coffee
if starts_with(to_string(.path), "/api") {
  .is_api_request = true
  .team = "backend"
} else {
  .is_api_request = false
  .team = "frontend"
}
```

Adds metadata fields based on the request path, which can be used for routing or filtering downstream.
