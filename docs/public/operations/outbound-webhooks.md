# Outbound Webhooks

VectorFlow can send HMAC-signed HTTP notifications to external systems when key events occur. Use outbound webhooks to integrate with incident management tools, CI/CD pipelines, custom dashboards, or any service that accepts HTTP callbacks.

## Overview

Each **webhook endpoint** is a URL that receives POST requests when one or more subscribed events fire. Requests carry Standard-Webhooks-compliant signature headers so receivers can verify authenticity.

Key properties of each endpoint:

- **Name** — A descriptive label shown in the management UI.
- **URL** — The HTTPS endpoint that receives event payloads.
- **Event types** — One or more event types that trigger delivery.
- **Signing secret** — Optional HMAC key. When set, every request includes a `webhook-signature` header.
- **Enabled / Disabled** — Endpoints can be temporarily disabled without deleting them.

## Supported events

| Event | When it fires |
|-------|---------------|
| `deploy_completed` | A pipeline deployment completed successfully |
| `deploy_rejected` | A deployment request was rejected |
| `deploy_cancelled` | A pending deployment was cancelled |
| `pipeline_crashed` | A running pipeline process exited unexpectedly |
| `node_unreachable` | A fleet node stopped sending heartbeats |
| `node_joined` | A new fleet node enrolled |
| `node_left` | A fleet node was removed |
| `promotion_completed` | A pipeline was promoted to another environment |

## Creating a webhook endpoint

{% stepper %}
{% step %}
### Open Webhook Settings
Navigate to **Settings → Outbound Webhooks**.
{% endstep %}
{% step %}
### Click New Endpoint
Click the **New Endpoint** button in the top-right corner.
{% endstep %}
{% step %}
### Fill in the form
- **Name** — A descriptive label (e.g., "PagerDuty Pipeline Alerts").
- **Endpoint URL** — The HTTPS URL that will receive events.
- **Signing secret** — Optional. If provided, every request is signed and the secret is shown once — copy it before closing the dialog.
- **Event types** — Select one or more events this endpoint should receive.
{% endstep %}
{% step %}
### Create
Click **Create**. If you provided a signing secret, the dialog shows it once — copy it to a secure location.
{% endstep %}
{% endstepper %}

{% hint style="warning" %}
The signing secret is displayed once at creation time and cannot be retrieved afterwards. Store it securely in your receiving application's configuration.
{% endhint %}

## Payload format

All webhook deliveries use the same envelope format:

```json
{
  "type": "deploy_completed",
  "timestamp": "2026-03-27T12:00:00.000Z",
  "data": {
    // Event-specific fields
  }
}
```

| Field | Description |
|-------|-------------|
| `type` | The `AlertMetric` value that triggered this delivery |
| `timestamp` | ISO-8601 UTC timestamp of the event |
| `data` | Event-specific payload fields |

## Verifying signatures

When a signing secret is configured, every request includes three headers:

| Header | Description |
|--------|-------------|
| `webhook-id` | Unique UUID for this delivery |
| `webhook-timestamp` | Unix timestamp (integer seconds) |
| `webhook-signature` | `v1,{base64(HMAC-SHA256)}` |

To verify a request, compute:

```
signing_string = "{webhook-id}.{webhook-timestamp}.{raw_request_body}"
expected_sig   = base64( HMAC-SHA256(signing_string, secret) )
```

The received signature header is `v1,{expected_sig}`. Compare the value after the `v1,` prefix.

{% hint style="info" %}
VectorFlow follows the [Standard Webhooks](https://www.standardwebhooks.com/) specification. Libraries are available for most languages.
{% endhint %}

## Delivery and retry

VectorFlow attempts delivery immediately when an event fires. If the request fails, it retries with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5+ | 2 hours |

**Permanent failures** (HTTP 4xx excluding 429, DNS errors, connection refused) are moved to **dead-letter** immediately and are not retried.

**Transient failures** (HTTP 5xx, HTTP 429, timeouts) are retried up to the schedule above.

## Delivery history

Each endpoint row in the settings UI can be expanded to show recent deliveries:

- **Event type** — Which event triggered the delivery.
- **Status** — `success`, `failed`, `dead_letter`, or `pending`.
- **HTTP status** — The HTTP status code returned by the receiver.
- **Attempt** — Which retry attempt this represents.
- **Requested / Completed** — Relative timestamps.

## Test delivery

To send a test delivery to an endpoint without waiting for a real event, click the **Play** button (&#9654;) in the endpoint row. The test payload is:

```json
{
  "type": "test",
  "timestamp": "2026-03-27T12:00:00.000Z",
  "data": {
    "message": "Test delivery from VectorFlow",
    "endpointId": "..."
  }
}
```

The UI shows a success or failure notification. Check delivery history for the HTTP status code and any error details.

## Managing endpoints

| Action | How |
|--------|-----|
| **Enable / Disable** | Click the toggle icon in the endpoint row |
| **Edit** | Click the pencil icon to update name, URL, events, or rotate the secret |
| **Delete** | Click the trash icon — all delivery history is also deleted |

{% hint style="info" %}
Disabling an endpoint stops deliveries immediately without deleting the endpoint or its history. Re-enable it when ready to receive events again.
{% endhint %}
