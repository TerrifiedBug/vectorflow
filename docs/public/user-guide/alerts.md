# Alerts

The **Alerts** page lets you configure rules that monitor your pipelines and nodes, receive notifications when something needs attention, and review a history of past alert events. Alerts are scoped to the currently selected environment.

## Overview

The Alerts page is organized into three sections:

- **Alert Rules** -- Define the conditions that trigger alerts.
- **Webhooks** -- Configure HTTP endpoints that receive notifications when alerts fire or resolve.
- **Alert History** -- Browse a chronological log of all alert events.

## Alert rules

An alert rule defines a metric to watch, a condition to evaluate, and how long the condition must persist before the alert fires.

### Creating an alert rule

{% stepper %}
{% step %}
### Open the Alerts page
Select an environment from the header, then navigate to **Alerts** in the sidebar.
{% endstep %}
{% step %}
### Click Add Rule
Click the **Add Rule** button in the Alert Rules section.
{% endstep %}
{% step %}
### Configure the rule
Fill in the rule form:

- **Name** -- A descriptive label (e.g., "High CPU on prod nodes").
- **Pipeline** (optional) -- Scope the rule to a specific pipeline, or leave as "All pipelines" for environment-wide monitoring.
- **Metric** -- The metric to evaluate (see supported metrics below).
- **Threshold** -- The numeric value that triggers the alert (not required for binary metrics).
- **Duration** -- How many seconds the condition must persist before firing. Defaults to 60 seconds.
{% endstep %}
{% step %}
### Save
Click **Create Rule**. The rule is enabled by default and begins evaluating on the next agent heartbeat.
{% endstep %}
{% endstepper %}

### Supported metrics

| Metric | Type | Description |
|--------|------|-------------|
| **CPU Usage** | Percentage | CPU utilization derived from cumulative CPU seconds. |
| **Memory Usage** | Percentage | Memory used as a percentage of total memory. |
| **Disk Usage** | Percentage | Filesystem used as a percentage of total disk space. |
| **Error Rate** | Percentage | Errors as a percentage of total events ingested. |
| **Discarded Rate** | Percentage | Discarded events as a percentage of total events ingested. |
| **Node Unreachable** | Binary | Fires when a node stops sending heartbeats. |
| **Pipeline Crashed** | Binary | Fires when a pipeline enters the crashed state. |

Percentage-based metrics use the conditions **>** (greater than), **<** (less than), or **=** (equals) against a threshold value. Binary metrics (Node Unreachable, Pipeline Crashed) fire automatically when the condition is detected -- no threshold is needed.

### Condition evaluation

Alert rules are evaluated during each agent heartbeat cycle. The evaluation logic works as follows:

1. The metric value is read from the latest node data.
2. If the value meets the condition (e.g., CPU > 80), a timer starts.
3. If the condition persists for the configured **duration** (in seconds), the alert fires and an event is created.
4. If the condition clears before the duration elapses, the timer resets.
5. When a firing alert's condition clears, the alert automatically resolves.

{% hint style="info" %}
The duration setting prevents transient spikes from triggering alerts. A 60-second duration means the condition must hold for a full minute before an alert fires.
{% endhint %}

### Managing rules

- **Enable / Disable** -- Toggle the switch in the rules table to enable or disable a rule without deleting it.
- **Edit** -- Click the pencil icon to update the rule name, threshold, or duration.
- **Delete** -- Click the trash icon to permanently remove the rule and stop future evaluations.

## Webhooks

Webhooks deliver alert notifications to external systems via HTTP POST requests. When an alert fires or resolves, VectorFlow sends a JSON payload to all enabled webhooks in the environment.

### Adding a webhook

{% stepper %}
{% step %}
### Click Add Webhook
In the Webhooks section, click **Add Webhook**.
{% endstep %}
{% step %}
### Configure the endpoint
- **URL** -- The HTTPS endpoint that will receive alert payloads.
- **Headers** (optional) -- A JSON object of custom headers to include with each request (e.g., `{"Authorization": "Bearer token"}`).
- **HMAC Secret** (optional) -- If set, each request includes an `X-VectorFlow-Signature` header containing a SHA-256 HMAC of the request body. Use this to verify that payloads originate from VectorFlow.
{% endstep %}
{% step %}
### Test the webhook
After creating the webhook, click the **send** icon in the webhooks table to deliver a test payload. VectorFlow reports the HTTP status code so you can confirm your endpoint is reachable.
{% endstep %}
{% endstepper %}

{% hint style="warning" %}
Make sure to test your webhook endpoint after creating it. A misconfigured URL or authentication header will silently drop alert notifications.
{% endhint %}

### Webhook payload

Each webhook delivery sends a JSON POST body with the following fields:

```json
{
  "alertId": "evt_abc123",
  "status": "firing",
  "ruleName": "High CPU Usage",
  "severity": "warning",
  "environment": "Production",
  "team": "Platform",
  "node": "node-01.example.com",
  "metric": "cpu_usage",
  "value": 85.5,
  "threshold": 80,
  "message": "CPU usage is 85.50 (threshold: > 80)",
  "timestamp": "2026-03-06T12:00:00.000Z",
  "dashboardUrl": "https://vectorflow.example.com/alerts",
  "content": "**Alert FIRING: High CPU Usage**\n> CPU usage is 85.50 ..."
}
```

The `content` field contains a pre-formatted, human-readable summary suitable for chat platforms like Slack or Discord. Generic consumers can ignore it and use the structured fields instead.

### Webhook security

- **HMAC signing** -- When an HMAC secret is configured, VectorFlow computes `sha256=<hex-digest>` over the raw JSON body and includes it in the `X-VectorFlow-Signature` header. Verify this on your server to ensure payload authenticity.
- **SSRF protection** -- VectorFlow validates that webhook URLs resolve to public IP addresses. Private and reserved IP ranges are blocked.
- **Timeout** -- Webhook deliveries time out after 10 seconds.

### Managing webhooks

- **Enable / Disable** -- Toggle the switch to pause or resume deliveries without deleting the webhook.
- **Edit** -- Click the pencil icon to update the URL, headers, or HMAC secret.
- **Test** -- Click the send icon to deliver a test payload.
- **Delete** -- Click the trash icon to permanently remove the webhook.

## Alert history

The **Alert History** section shows a chronological list of all alert events in the current environment. Each row displays:

| Column | Description |
|--------|-------------|
| **Timestamp** | When the alert fired. |
| **Rule Name** | The alert rule that triggered. |
| **Node** | The node where the condition was detected. |
| **Pipeline** | The pipeline associated with the rule (or "-" for environment-wide rules). |
| **Status** | **Firing** (red) or **Resolved** (green). |
| **Value** | The metric value at the time the alert was evaluated. |
| **Message** | A human-readable summary of the condition. |

Click **Load more** at the bottom of the table to fetch older events. Events are ordered newest-first.

## Alert states

An alert event transitions through two states:

- **Firing** -- The rule's condition has been met for the required duration. The alert is active and webhook notifications have been sent.
- **Resolved** -- The condition is no longer met. The alert closes automatically and a resolution notification is sent to all enabled webhooks.
