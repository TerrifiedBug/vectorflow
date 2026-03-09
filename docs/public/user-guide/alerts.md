# Alerts

The **Alerts** page lets you configure rules that monitor your pipelines and nodes, receive notifications when something needs attention, and review a history of past alert events. Alerts are scoped to the currently selected environment.

## Overview

The Alerts page is organized into four sections:

- **Alert Rules** -- Define the conditions that trigger alerts.
- **Notification Channels** -- Configure where alert notifications are delivered (Slack, Email, PagerDuty, or Webhook).
- **Legacy Webhooks** -- Existing HTTP webhook endpoints (shown only if legacy webhooks exist).
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
- **Notification Channels** (optional) -- Select specific channels for this rule. If none are selected, all enabled channels in the environment receive notifications.
{% endstep %}
{% step %}
### Save
Click **Create Rule**. The rule is enabled by default and begins evaluating on the next agent heartbeat.
{% endstep %}
{% endstepper %}

### Supported metrics

VectorFlow supports three categories of alert metrics: **Infrastructure** metrics that monitor resource utilization with thresholds, **Binary** metrics that fire on detected conditions, and **Event** metrics that fire when specific system events occur.

#### Infrastructure metrics

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

#### Event metrics

Event metrics fire whenever a specific system event occurs. Unlike infrastructure metrics, they have **no threshold** -- the alert triggers on each occurrence. Event rules are created the same way as infrastructure rules, but you select a metric from the **Events** category in the metric dropdown.

| Metric | Description |
|--------|-------------|
| **Deploy Requested** | A deploy request was submitted for approval. |
| **Deploy Completed** | A pipeline was successfully deployed to agents. |
| **Deploy Rejected** | A deploy request was rejected by a reviewer. |
| **Deploy Cancelled** | A deploy request was cancelled. |
| **New Version Available** | A new VectorFlow server version is available. |
| **SCIM Sync Failed** | A SCIM provisioning operation failed. |
| **Backup Failed** | A scheduled database backup failed. |
| **Certificate Expiring** | A TLS certificate is approaching its expiration date. |
| **Node Joined** | A new agent node enrolled in the environment. |
| **Node Left** | An agent node was removed or disconnected from the environment. |

{% hint style="info" %}
Event alerts use the same notification channels as infrastructure alerts (Slack, Email, PagerDuty, Webhook). You can route event alerts to specific channels by linking channels to the rule, just like any other alert rule.
{% endhint %}

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
- **Edit** -- Click the pencil icon to update the rule name, threshold, duration, or linked notification channels.
- **Delete** -- Click the trash icon to permanently remove the rule and stop future evaluations.

## Notification channels

Notification channels define where alert notifications are delivered. VectorFlow supports four channel types: **Slack**, **Email**, **PagerDuty**, and **Webhook**. When an alert fires or resolves, notifications are sent to all enabled channels -- or to specific channels linked to the alert rule.

### Adding a channel

{% stepper %}
{% step %}
### Click Add Channel
In the Notification Channels section, click **Add Channel**.
{% endstep %}
{% step %}
### Choose a type
Select the channel type from the dropdown: Slack, Email, PagerDuty, or Webhook. Each type has its own configuration form.
{% endstep %}
{% step %}
### Configure the channel
Fill in the type-specific settings (see setup examples below).
{% endstep %}
{% step %}
### Test the channel
After creating the channel, click the **send** icon in the channels table to deliver a test payload. VectorFlow reports whether delivery succeeded.
{% endstep %}
{% endstepper %}

{% hint style="warning" %}
Always test your channel after creating it. Misconfigured credentials or URLs will silently drop alert notifications.
{% endhint %}

### Channel types

{% tabs %}
{% tab title="Slack" %}
#### Slack setup

Deliver alerts to a Slack channel using an Incoming Webhook.

**Configuration:**

- **Webhook URL** -- The Slack Incoming Webhook URL (e.g., `https://hooks.slack.com/services/T00.../B00.../xxx`).

**How to get a webhook URL:**

1. Go to [Slack API: Incoming Webhooks](https://api.slack.com/messaging/webhooks).
2. Create a new app or select an existing one.
3. Enable Incoming Webhooks and add a new webhook to a channel.
4. Copy the webhook URL and paste it into VectorFlow.

Alerts are delivered using Slack Block Kit formatting with color-coded status indicators, metric details, and a link to the VectorFlow dashboard.
{% endtab %}

{% tab title="Email" %}
#### Email setup

Deliver alerts via SMTP email.

**Configuration:**

- **SMTP Host** -- Your mail server hostname (e.g., `smtp.gmail.com`).
- **SMTP Port** -- The SMTP port (typically `587` for STARTTLS or `465` for SSL).
- **SMTP User** (optional) -- Username for SMTP authentication.
- **SMTP Password** (optional) -- Password for SMTP authentication.
- **From Address** -- The sender email address.
- **Recipients** -- Comma-separated list of recipient email addresses.

**Example with Gmail:**

| Setting | Value |
|---------|-------|
| SMTP Host | `smtp.gmail.com` |
| SMTP Port | `587` |
| SMTP User | `alerts@yourcompany.com` |
| SMTP Password | App-specific password |
| From | `alerts@yourcompany.com` |
| Recipients | `ops@yourcompany.com, oncall@yourcompany.com` |

{% hint style="info" %}
If your SMTP server does not require authentication, leave the SMTP User and Password fields empty.
{% endhint %}
{% endtab %}

{% tab title="PagerDuty" %}
#### PagerDuty setup

Trigger and resolve PagerDuty incidents using the Events API v2.

**Configuration:**

- **Integration Key** -- The routing key from your PagerDuty service integration.

**How to get an integration key:**

1. In PagerDuty, go to **Services** and select (or create) a service.
2. Under **Integrations**, add a new integration of type **Events API v2**.
3. Copy the **Integration Key** and paste it into VectorFlow.

**Behavior:**

- **Firing** alerts create a `trigger` event in PagerDuty.
- **Resolved** alerts send a `resolve` event, automatically closing the PagerDuty incident.
- VectorFlow uses the alert event ID as the PagerDuty `dedup_key`, so repeated firings of the same alert update the same incident.
{% endtab %}

{% tab title="Webhook" %}
#### Webhook setup

Deliver alerts to any HTTP endpoint via a JSON POST request. This is the most flexible option, suitable for custom integrations, chat platforms, or automation tools.

**Configuration:**

- **URL** -- The HTTPS endpoint that will receive alert payloads.
- **Headers** (optional) -- A JSON object of custom headers (e.g., `{"Authorization": "Bearer token"}`).
- **HMAC Secret** (optional) -- If set, each request includes an `X-VectorFlow-Signature` header with a SHA-256 HMAC of the body.

The webhook payload is a JSON object containing all alert details including `alertId`, `status`, `ruleName`, `metric`, `value`, `threshold`, `message`, `timestamp`, and a `dashboardUrl` link.
{% endtab %}
{% endtabs %}

### Channel routing

By default, all enabled notification channels in an environment receive every alert. To send specific alerts to specific channels:

1. Edit an alert rule (or create a new one).
2. In the **Notification Channels** section of the rule form, click the channel badges to select which channels should receive notifications for that rule.
3. Save the rule.

If no channels are explicitly selected for a rule, all enabled channels are used as a fallback.

### Managing channels

- **Enable / Disable** -- Toggle the switch to pause or resume deliveries without deleting the channel.
- **Edit** -- Click the pencil icon to update the channel name or configuration.
- **Test** -- Click the send icon to deliver a test payload.
- **Delete** -- Click the trash icon to permanently remove the channel.

## Legacy webhooks

If you previously configured webhooks before notification channels were introduced, they continue to work. The **Legacy Webhooks** section appears only when legacy webhooks exist.

{% hint style="info" %}
Consider migrating legacy webhooks to Notification Channels for a unified configuration experience. Create a new **Webhook** type notification channel with the same URL, headers, and HMAC secret, then delete the legacy webhook.
{% endhint %}

### Webhook payload

Each webhook delivery (both legacy and Webhook-type notification channels) sends a JSON POST body with the following fields:

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
- **SSRF protection** -- VectorFlow validates that webhook and Slack URLs resolve to public IP addresses. Private and reserved IP ranges are blocked.
- **Timeout** -- All notification channel deliveries time out after 10 seconds.

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

- **Firing** -- The rule's condition has been met for the required duration. The alert is active and notifications have been sent to all configured channels.
- **Resolved** -- The condition is no longer met. The alert closes automatically and a resolution notification is sent to all configured channels.
